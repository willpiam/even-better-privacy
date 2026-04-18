import { HttpError, STATUS, bytesToBase64, base64ToBytes } from "./http.ts";
import { toSafeString, clampPort, asBool } from "./identity.ts";
import { getOAuthProviderConfig, toOAuthProvider, refreshOAuthToken } from "./mail-oauth.ts";

export type MailAuthType = "oauth" | "password";
export type MailOauthProvider = "gmail" | "outlook" | "";
export type MailAuthSecrets = {
	imapPassword: string;
	smtpPassword: string;
	accessToken?: string;
	refreshToken?: string;
	tokenExpiry?: number;
};
export type MailAccountConfig = {
	gmailMode: boolean;
	authType: MailAuthType;
	oauthProvider: MailOauthProvider;
	imapHost: string;
	imapPort: number;
	imapSecure: boolean;
	smtpHost: string;
	smtpPort: number;
	smtpSecure: boolean;
	username: string;
	fromEmail: string;
	fromName: string;
	persistSecrets: boolean;
};
export type MailAccountRecord = {
	id: string;
	name: string;
	config: MailAccountConfig;
	createdAt: number;
	updatedAt: number;
};
export type MailAccountStore = {
	selectedAccountId: string | null;
	accounts: MailAccountRecord[];
};
export type MailSecretsStore = Record<string, MailAuthSecrets>;
export type EncryptedMailSecretsEnvelope = {
	version: 1;
	algorithm: "AES-GCM";
	kdf: "PBKDF2-SHA-256";
	iterations: number;
	salt: string;
	iv: string;
	ciphertext: string;
};

export const DEFAULT_MAIL_ACCOUNT: MailAccountConfig = {
	gmailMode: false,
	authType: "password",
	oauthProvider: "",
	imapHost: "",
	imapPort: 993,
	imapSecure: true,
	smtpHost: "",
	smtpPort: 465,
	smtpSecure: true,
	username: "",
	fromEmail: "",
	fromName: "",
	persistSecrets: false,
};

const MAIL_ACCOUNT_FILE = "mail-account.json";
const MAIL_SECRET_FILE = "mail-account.secrets.json";
const DEFAULT_MAIL_STORE: MailAccountStore = { selectedAccountId: null, accounts: [] };
const MAIL_SECRETS_KDF_ITERATIONS = 210_000;

export const mailSecretCache = new Map<string, MailSecretsStore>();
export const mailPinCache = new Map<string, string>();

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const out = new Uint8Array(bytes.length);
	out.set(bytes);
	return out.buffer;
}

export function mailboxPath(identityDir: string, fileName: string): string {
	return `${identityDir}/${fileName}`;
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
	try {
		const raw = await Deno.readTextFile(path);
		return JSON.parse(raw) as T;
	} catch (e) {
		if (e instanceof Deno.errors.NotFound) return null;
		return null;
	}
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await Deno.writeTextFile(path, JSON.stringify(value, null, 2));
	try {
		await Deno.chmod(path, 0o600);
	} catch {
		// Best effort on platforms where chmod may not be supported.
	}
}

export function isMailAuthType(value: unknown): value is MailAuthType {
	return value === "oauth" || value === "password";
}

export function isMailOauthProvider(value: unknown): value is Exclude<MailOauthProvider, ""> {
	return value === "gmail" || value === "outlook";
}

export function isMailAccountConfig(value: unknown): value is MailAccountConfig {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return typeof v.imapHost === "string" &&
		typeof v.smtpHost === "string" &&
		typeof v.username === "string" &&
		(isMailAuthType(v.authType) || v.authType === undefined);
}

export function normalizeMailConfig(
	base: MailAccountConfig,
	payload?: Record<string, unknown> | null,
): MailAccountConfig {
	const p = payload ?? {};
	const authType: MailAuthType = isMailAuthType(p.authType) ? p.authType : (base.authType ?? "password");
	const oauthProvider: MailOauthProvider = toOAuthProvider(p.oauthProvider ?? base.oauthProvider);
	const next: MailAccountConfig = {
		gmailMode: asBool(p.gmailMode, base.gmailMode),
		authType,
		oauthProvider,
		imapHost: toSafeString(p.imapHost ?? base.imapHost),
		imapPort: clampPort(p.imapPort ?? base.imapPort, 993),
		imapSecure: asBool(p.imapSecure, base.imapSecure),
		smtpHost: toSafeString(p.smtpHost ?? base.smtpHost),
		smtpPort: clampPort(p.smtpPort ?? base.smtpPort, 465),
		smtpSecure: asBool(p.smtpSecure, base.smtpSecure),
		username: toSafeString(p.username ?? base.username),
		fromEmail: toSafeString(p.fromEmail ?? base.fromEmail),
		fromName: toSafeString(p.fromName ?? base.fromName),
		persistSecrets: asBool(p.persistSecrets, base.persistSecrets),
	};
	if (next.authType === "oauth") {
		const provider = getOAuthProviderConfig(next.oauthProvider);
		next.imapHost = provider.imapHost;
		next.imapPort = provider.imapPort;
		next.imapSecure = provider.imapSecure;
		next.smtpHost = provider.smtpHost;
		next.smtpPort = provider.smtpPort;
		next.smtpSecure = provider.smtpSecure;
		next.persistSecrets = true;
	}
	if (!next.imapHost || !next.smtpHost || !next.username || !next.fromEmail) {
		throw new HttpError(STATUS.BadRequest, "imapHost, smtpHost, username, and fromEmail are required");
	}
	if (next.authType === "oauth" && !next.oauthProvider) {
		throw new HttpError(STATUS.BadRequest, "oauthProvider is required for oauth accounts");
	}
	return next;
}

export async function getMailStore(identityDir: string): Promise<MailAccountStore> {
	const raw = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_ACCOUNT_FILE));
	if (!raw) return { ...DEFAULT_MAIL_STORE };
	if (isMailAccountConfig(raw)) {
		const now = Date.now();
		return {
			selectedAccountId: "default",
			accounts: [{
				id: "default",
				name: "Default account",
				config: raw,
				createdAt: now,
				updatedAt: now,
			}],
		};
	}
	if (typeof raw === "object" && raw) {
		const parsed = raw as Partial<MailAccountStore>;
		const accounts = Array.isArray(parsed.accounts) ? parsed.accounts.filter((item) => {
			if (!item || typeof item !== "object") return false;
			const rec = item as Partial<MailAccountRecord>;
			return typeof rec.id === "string" && typeof rec.name === "string" && isMailAccountConfig(rec.config);
		}).map((item) => item as MailAccountRecord) : [];
		const selectedAccountId = typeof parsed.selectedAccountId === "string" ? parsed.selectedAccountId : null;
		return { selectedAccountId, accounts };
	}
	return { ...DEFAULT_MAIL_STORE };
}

export async function saveMailStore(identityDir: string, store: MailAccountStore): Promise<void> {
	await writePrivateJson(mailboxPath(identityDir, MAIL_ACCOUNT_FILE), store);
}

export function isEncryptedSecretsEnvelope(value: unknown): value is EncryptedMailSecretsEnvelope {
	if (!value || typeof value !== "object") return false;
	const v = value as Record<string, unknown>;
	return v.version === 1 &&
		v.algorithm === "AES-GCM" &&
		v.kdf === "PBKDF2-SHA-256" &&
		typeof v.iterations === "number" &&
		typeof v.salt === "string" &&
		typeof v.iv === "string" &&
		typeof v.ciphertext === "string";
}

export function parseLegacySecretsStore(raw: unknown): MailSecretsStore {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const maybeLegacy = raw as Partial<MailAuthSecrets>;
	if (typeof maybeLegacy.imapPassword === "string" && typeof maybeLegacy.smtpPassword === "string") {
		return {
			default: {
				imapPassword: maybeLegacy.imapPassword,
				smtpPassword: maybeLegacy.smtpPassword,
				accessToken: typeof maybeLegacy.accessToken === "string" ? maybeLegacy.accessToken : undefined,
				refreshToken: typeof maybeLegacy.refreshToken === "string" ? maybeLegacy.refreshToken : undefined,
				tokenExpiry: typeof maybeLegacy.tokenExpiry === "number" ? maybeLegacy.tokenExpiry : undefined,
			},
		};
	}
	const out: MailSecretsStore = {};
	for (const [accountId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") continue;
		const sec = value as Partial<MailAuthSecrets>;
		if (typeof sec.imapPassword === "string" && typeof sec.smtpPassword === "string") {
			out[accountId] = {
				imapPassword: sec.imapPassword,
				smtpPassword: sec.smtpPassword,
				accessToken: typeof sec.accessToken === "string" ? sec.accessToken : undefined,
				refreshToken: typeof sec.refreshToken === "string" ? sec.refreshToken : undefined,
				tokenExpiry: typeof sec.tokenExpiry === "number" ? sec.tokenExpiry : undefined,
			};
		}
	}
	return out;
}

export async function deriveMailSecretsKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pin),
		{ name: "PBKDF2" },
		false,
		["deriveKey"],
	);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
		baseKey,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"],
	);
}

export async function encryptSecretsStore(store: MailSecretsStore, pin: string): Promise<EncryptedMailSecretsEnvelope> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveMailSecretsKey(pin, salt, MAIL_SECRETS_KDF_ITERATIONS);
	const plaintext = new TextEncoder().encode(JSON.stringify(store));
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
	return {
		version: 1,
		algorithm: "AES-GCM",
		kdf: "PBKDF2-SHA-256",
		iterations: MAIL_SECRETS_KDF_ITERATIONS,
		salt: bytesToBase64(salt),
		iv: bytesToBase64(iv),
		ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
	};
}

export async function decryptSecretsEnvelope(envelope: EncryptedMailSecretsEnvelope, pin: string): Promise<MailSecretsStore> {
	try {
		const key = await deriveMailSecretsKey(pin, base64ToBytes(envelope.salt), envelope.iterations);
		const iv = base64ToBytes(envelope.iv);
		const ciphertext = base64ToBytes(envelope.ciphertext);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: toArrayBuffer(iv) },
			key,
			toArrayBuffer(ciphertext),
		);
		return parseLegacySecretsStore(JSON.parse(new TextDecoder().decode(new Uint8Array(plaintext))));
	} catch {
		throw new HttpError(STATUS.Unauthorized, "invalid email pin");
	}
}

export async function getMailSecretsStatus(identityDir: string): Promise<{ inMemory: boolean; locked: boolean; store: MailSecretsStore | null }> {
	const cached = mailSecretCache.get(identityDir);
	if (cached) return { inMemory: true, locked: false, store: cached };
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) return { inMemory: false, locked: false, store: {} };
	if (isEncryptedSecretsEnvelope(diskSecrets)) return { inMemory: false, locked: true, store: null };
	return { inMemory: false, locked: false, store: parseLegacySecretsStore(diskSecrets) };
}

export async function getMailSecretsStore(identityDir: string): Promise<MailSecretsStore> {
	const cached = mailSecretCache.get(identityDir);
	if (cached) return cached;
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) {
		const empty: MailSecretsStore = {};
		mailSecretCache.set(identityDir, empty);
		return empty;
	}
	if (isEncryptedSecretsEnvelope(diskSecrets)) {
		const pin = mailPinCache.get(identityDir);
		if (!pin) throw new HttpError(STATUS.Unauthorized, "email pin required");
		const decrypted = await decryptSecretsEnvelope(diskSecrets, pin);
		mailSecretCache.set(identityDir, decrypted);
		return decrypted;
	}
	const legacy = parseLegacySecretsStore(diskSecrets);
	mailSecretCache.set(identityDir, legacy);
	return legacy;
}

export async function unlockMailSecretsWithPin(identityDir: string, pin: string): Promise<MailSecretsStore> {
	const diskSecrets = await readJsonFile<unknown>(mailboxPath(identityDir, MAIL_SECRET_FILE));
	if (!diskSecrets) {
		const empty: MailSecretsStore = {};
		mailSecretCache.set(identityDir, empty);
		mailPinCache.set(identityDir, pin);
		return empty;
	}
	if (isEncryptedSecretsEnvelope(diskSecrets)) {
		const decrypted = await decryptSecretsEnvelope(diskSecrets, pin);
		mailSecretCache.set(identityDir, decrypted);
		mailPinCache.set(identityDir, pin);
		return decrypted;
	}
	const legacy = parseLegacySecretsStore(diskSecrets);
	mailSecretCache.set(identityDir, legacy);
	mailPinCache.set(identityDir, pin);
	return legacy;
}

export async function saveMailSecretsStore(identityDir: string, store: MailSecretsStore): Promise<void> {
	mailSecretCache.set(identityDir, store);
	if (Object.keys(store).length === 0) {
		try {
			await Deno.remove(mailboxPath(identityDir, MAIL_SECRET_FILE));
		} catch (e) {
			if (!(e instanceof Deno.errors.NotFound)) throw e;
		}
		return;
	}
	const pin = mailPinCache.get(identityDir);
	if (!pin) throw new HttpError(STATUS.Unauthorized, "email pin required");
	const encrypted = await encryptSecretsStore(store, pin);
	await writePrivateJson(mailboxPath(identityDir, MAIL_SECRET_FILE), encrypted);
}

export function buildSmtpAuth(config: MailAccountConfig, secrets: MailAuthSecrets): Record<string, unknown> {
	if (config.authType === "oauth") {
		if (!secrets.accessToken) {
			throw new HttpError(STATUS.BadRequest, "mail oauth access token is not configured");
		}
		return { type: "OAuth2", user: config.username, accessToken: secrets.accessToken };
	}
	return { user: config.username, pass: secrets.smtpPassword };
}

export async function resolveMailAccount(identityDir: string, accountId?: string): Promise<{ account: MailAccountRecord; secrets: MailAuthSecrets }> {
	const store = await getMailStore(identityDir);
	if (!store.accounts.length) throw new HttpError(STATUS.BadRequest, "mail account is not configured");
	const selected = accountId ?? store.selectedAccountId ?? store.accounts[0].id;
	const account = store.accounts.find((entry) => entry.id === selected);
	if (!account) throw new HttpError(STATUS.NotFound, "mail account not found");
	const secretStore = await getMailSecretsStore(identityDir);
	let secrets = secretStore[account.id];
	if (account.config.authType === "oauth") {
		if (!secrets?.refreshToken && !secrets?.accessToken) {
			throw new HttpError(STATUS.BadRequest, "mail oauth credentials are not configured");
		}
		secrets = await refreshOAuthToken(identityDir, account.id, account.config, secrets ?? { imapPassword: "", smtpPassword: "" });
		if (!secrets.accessToken) throw new HttpError(STATUS.BadRequest, "mail oauth credentials are not configured");
		return { account, secrets };
	}
	if (!secrets?.imapPassword || !secrets?.smtpPassword) {
		throw new HttpError(STATUS.BadRequest, "mail credentials are not configured");
	}
	return { account, secrets };
}
