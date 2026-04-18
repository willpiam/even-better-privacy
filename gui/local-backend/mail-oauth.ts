import { apiUrl, readState } from "../../cli/utils.ts";
import { HttpError, STATUS } from "./http.ts";
import type {
	MailOauthProvider,
	MailAuthSecrets,
	MailAccountConfig,
	MailSecretsStore,
} from "./mail-account.ts";
import { isMailOauthProvider, getMailSecretsStore, saveMailSecretsStore } from "./mail-account.ts";

export type OAuthProviderConfig = {
	clientId: string;
	authUrl: string;
	scopes: string[];
	imapHost: string;
	imapPort: number;
	imapSecure: boolean;
	smtpHost: string;
	smtpPort: number;
	smtpSecure: boolean;
};

export type PendingMailOAuthStart = {
	provider: Exclude<MailOauthProvider, "">;
	createdAt: number;
	serverUrl: string;
};

export type CompletedMailOAuth = {
	provider: Exclude<MailOauthProvider, "">;
	createdAt: number;
	accessToken: string;
	refreshToken: string;
	tokenExpiry: number;
	email: string;
};

const MAIL_OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;
const MAIL_OAUTH_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const mailOauthStarts = new Map<string, PendingMailOAuthStart>();
export const mailOauthCompleted = new Map<string, CompletedMailOAuth>();

let _oauthProviderConfigs: Record<Exclude<MailOauthProvider, "">, OAuthProviderConfig> | null = null;

function ensureProviderConfigs(): Record<Exclude<MailOauthProvider, "">, OAuthProviderConfig> {
	if (_oauthProviderConfigs) return _oauthProviderConfigs;
	_oauthProviderConfigs = {
		gmail: {
			clientId: Deno.env.get("MAIL_OAUTH_GMAIL_CLIENT_ID") ?? "",
			authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
			scopes: ["https://mail.google.com/", "openid", "email"],
			imapHost: "imap.gmail.com",
			imapPort: 993,
			imapSecure: true,
			smtpHost: "smtp.gmail.com",
			smtpPort: 465,
			smtpSecure: true,
		},
		outlook: {
			clientId: Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_ID") ?? "",
			authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
			scopes: [
				"https://outlook.office.com/IMAP.AccessAsUser.All",
				"https://outlook.office.com/SMTP.Send",
				"offline_access",
				"openid",
				"email",
			],
			imapHost: "outlook.office365.com",
			imapPort: 993,
			imapSecure: true,
			smtpHost: "smtp.office365.com",
			smtpPort: 587,
			smtpSecure: false,
		},
	};
	return _oauthProviderConfigs;
}

export function getOAuthProviderConfigs(): Record<Exclude<MailOauthProvider, "">, OAuthProviderConfig> {
	return ensureProviderConfigs();
}

export { getOAuthProviderConfigs as OAUTH_PROVIDER_CONFIGS };

export function getOAuthProviderConfig(provider: unknown): OAuthProviderConfig {
	if (!isMailOauthProvider(provider)) {
		throw new HttpError(STATUS.BadRequest, "unsupported oauth provider");
	}
	const conf = ensureProviderConfigs()[provider];
	if (!conf.clientId) {
		throw new HttpError(STATUS.BadRequest, `oauth client id for ${provider} is not configured`);
	}
	return conf;
}

export function toOAuthProvider(value: unknown): MailOauthProvider {
	if (value === "gmail" || value === "outlook") return value;
	return "";
}

export function pruneExpiredOAuthState(): void {
	const cutoff = Date.now() - MAIL_OAUTH_PENDING_TTL_MS;
	for (const [state, pending] of mailOauthStarts.entries()) {
		if (pending.createdAt < cutoff) mailOauthStarts.delete(state);
	}
	for (const [state, completed] of mailOauthCompleted.entries()) {
		if (completed.createdAt < cutoff) mailOauthCompleted.delete(state);
	}
}

export function getMailOAuthRedirectUri(): string {
	return `http://127.0.0.1:${Number(Deno.env.get("GUI_BACKEND_PORT") ?? "8787")}/api/v1/mail/oauth/callback`;
}

export async function exchangeOAuthCode(
	serverUrl: string,
	provider: Exclude<MailOauthProvider, "">,
	code: string,
): Promise<{ accessToken: string; refreshToken: string; tokenExpiry: number; email: string }> {
	const exchangeUrl = apiUrl(serverUrl, "/api/v1/mail/oauth/exchange");
	const res = await fetch(exchangeUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider, code, redirectUri: getMailOAuthRedirectUri() }),
	});
	const body = await res.json().catch(() => ({})) as Record<string, unknown>;
	if (!res.ok) {
		const reason = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
		throw new HttpError(STATUS.BadGateway, `oauth token exchange failed: ${reason}`);
	}
	const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
	const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken : "";
	const tokenExpiry = typeof body.tokenExpiry === "number" ? body.tokenExpiry : Date.now() + 3600_000;
	const email = typeof body.email === "string" ? body.email : "";
	if (!accessToken || !refreshToken || !email) {
		throw new HttpError(STATUS.BadGateway, "oauth token response missing required fields");
	}
	return { accessToken, refreshToken, tokenExpiry, email };
}

export async function refreshOAuthToken(
	identityDir: string,
	accountId: string,
	config: MailAccountConfig,
	secrets: MailAuthSecrets,
): Promise<MailAuthSecrets> {
	if (config.authType !== "oauth") return secrets;
	if (!secrets.refreshToken) throw new HttpError(STATUS.BadRequest, "mail oauth refresh token is not configured");
	const stillValid = typeof secrets.tokenExpiry === "number" &&
		secrets.tokenExpiry > Date.now() + MAIL_OAUTH_REFRESH_SKEW_MS &&
		typeof secrets.accessToken === "string" &&
		secrets.accessToken.length > 0;
	if (stillValid) return secrets;
	const state = await readState(identityDir);
	const serverUrl = state?.server;
	if (!serverUrl) throw new HttpError(STATUS.BadRequest, "server is not configured; needed for oauth token refresh");
	const provider = config.oauthProvider as Exclude<MailOauthProvider, "">;
	const refreshUrl = apiUrl(serverUrl, "/api/v1/mail/oauth/refresh");
	const res = await fetch(refreshUrl, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ provider, refreshToken: secrets.refreshToken }),
	});
	const body = await res.json().catch(() => ({})) as Record<string, unknown>;
	if (!res.ok) {
		const reason = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
		throw new HttpError(STATUS.BadGateway, `oauth token refresh failed: ${reason}`);
	}
	const accessToken = typeof body.accessToken === "string" ? body.accessToken : "";
	if (!accessToken) throw new HttpError(STATUS.BadGateway, "oauth token refresh did not return an access token");
	const updated: MailAuthSecrets = {
		...secrets,
		accessToken,
		tokenExpiry: typeof body.tokenExpiry === "number" ? body.tokenExpiry : Date.now() + 3600_000,
		refreshToken: typeof body.refreshToken === "string" ? body.refreshToken : secrets.refreshToken,
	};
	const secretStore = await getMailSecretsStore(identityDir);
	secretStore[accountId] = updated;
	await saveMailSecretsStore(identityDir, secretStore);
	return updated;
}
