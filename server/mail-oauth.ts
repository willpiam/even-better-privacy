import { readJsonBody } from "./body.ts";
import { json } from "./response.ts";

// =============================================================================
// Mail OAuth Proxy Configuration (secrets stay on this server)
// =============================================================================

export type MailOauthProvider = "gmail" | "outlook";

export interface OAuthProviderServerConfig {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
}

const OAUTH_PROVIDER_SERVER_CONFIGS: Record<MailOauthProvider, OAuthProviderServerConfig> = {
  gmail: {
    clientId: Deno.env.get("MAIL_OAUTH_GMAIL_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("MAIL_OAUTH_GMAIL_CLIENT_SECRET") ?? "",
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  outlook: {
    clientId: Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_ID") ?? "",
    clientSecret: Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_SECRET") ?? "",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  },
};

export function isMailOauthProvider(value: unknown): value is MailOauthProvider {
  return value === "gmail" || value === "outlook";
}

export function getOAuthServerConfig(provider: MailOauthProvider): OAuthProviderServerConfig {
  const conf = OAUTH_PROVIDER_SERVER_CONFIGS[provider];
  if (!conf.clientId || !conf.clientSecret) {
    throw new Error(`oauth credentials for ${provider} are not configured on server`);
  }
  return conf;
}

export function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 ? "=".repeat(4 - (normalized.length % 4)) : "";
  return atob(normalized + padding);
}

export function parseJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    return JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function fetchOAuthUserEmail(provider: MailOauthProvider, accessToken: string): Promise<string | null> {
  try {
    const userInfoUrl = provider === "gmail"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/oidc/userinfo";
    const res = await fetch(userInfoUrl, { headers: { authorization: `Bearer ${accessToken}` } });
    if (!res.ok) return null;
    const body = await res.json();
    const email = typeof body?.email === "string"
      ? body.email
      : typeof body?.preferred_username === "string"
      ? body.preferred_username
      : typeof body?.upn === "string"
      ? body.upn
      : null;
    return email ? email.toLowerCase() : null;
  } catch {
    return null;
  }
}

export async function handleOAuthExchange(req: Request): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) return json({ error: bodyResult.error }, bodyResult.status);

  const { provider: rawProvider, code: rawCode, redirectUri: rawRedirectUri } = bodyResult.data;

  if (!isMailOauthProvider(rawProvider)) {
    return json({ error: "provider must be gmail or outlook" }, 400);
  }
  if (typeof rawCode !== "string" || !rawCode) {
    return json({ error: "code is required" }, 400);
  }
  if (typeof rawRedirectUri !== "string" || !rawRedirectUri) {
    return json({ error: "redirectUri is required" }, 400);
  }

  const conf = getOAuthServerConfig(rawProvider);
  const payload = new URLSearchParams({
    client_id: conf.clientId,
    client_secret: conf.clientSecret,
    code: rawCode,
    redirect_uri: rawRedirectUri,
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(conf.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    const reason = (tokenBody as { error_description?: string; error?: string }).error_description ??
      (tokenBody as { error?: string }).error ??
      `HTTP ${tokenRes.status}`;
    return json({ error: `oauth token exchange failed: ${reason}` }, 502);
  }

  const accessToken = typeof (tokenBody as { access_token?: unknown }).access_token === "string"
    ? (tokenBody as { access_token: string }).access_token : "";
  const refreshToken = typeof (tokenBody as { refresh_token?: unknown }).refresh_token === "string"
    ? (tokenBody as { refresh_token: string }).refresh_token : "";
  const expiresIn = Number((tokenBody as { expires_in?: unknown }).expires_in ?? 3600) || 3600;
  const tokenExpiry = Date.now() + expiresIn * 1000;

  const idToken = typeof (tokenBody as { id_token?: unknown }).id_token === "string"
    ? (tokenBody as { id_token: string }).id_token : "";
  const jwtPayload = idToken ? parseJwtPayload(idToken) : null;
  const emailFromIdToken = jwtPayload && (
    typeof jwtPayload.email === "string" ? jwtPayload.email :
    typeof jwtPayload.preferred_username === "string" ? jwtPayload.preferred_username :
    typeof jwtPayload.upn === "string" ? jwtPayload.upn :
    ""
  );
  const fallbackEmail = await fetchOAuthUserEmail(rawProvider, accessToken);
  const email = (emailFromIdToken || fallbackEmail || "").trim().toLowerCase();

  if (!accessToken || !refreshToken || !email) {
    return json({ error: "oauth token response missing required fields" }, 502);
  }

  return json({ accessToken, refreshToken, tokenExpiry, email });
}

export async function handleOAuthRefresh(req: Request): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) return json({ error: bodyResult.error }, bodyResult.status);

  const { provider: rawProvider, refreshToken: rawRefreshToken } = bodyResult.data;

  if (!isMailOauthProvider(rawProvider)) {
    return json({ error: "provider must be gmail or outlook" }, 400);
  }
  if (typeof rawRefreshToken !== "string" || !rawRefreshToken) {
    return json({ error: "refreshToken is required" }, 400);
  }

  const conf = getOAuthServerConfig(rawProvider);
  const payload = new URLSearchParams({
    client_id: conf.clientId,
    client_secret: conf.clientSecret,
    grant_type: "refresh_token",
    refresh_token: rawRefreshToken,
  });

  const tokenRes = await fetch(conf.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString(),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    const reason = (tokenBody as { error_description?: string; error?: string }).error_description ??
      (tokenBody as { error?: string }).error ??
      `HTTP ${tokenRes.status}`;
    return json({ error: `oauth token refresh failed: ${reason}` }, 502);
  }

  const accessToken = typeof (tokenBody as { access_token?: unknown }).access_token === "string"
    ? (tokenBody as { access_token: string }).access_token : "";
  if (!accessToken) {
    return json({ error: "oauth token refresh did not return an access token" }, 502);
  }
  const expiresIn = Number((tokenBody as { expires_in?: unknown }).expires_in ?? 3600) || 3600;
  const newRefreshToken = typeof (tokenBody as { refresh_token?: unknown }).refresh_token === "string"
    ? (tokenBody as { refresh_token: string }).refresh_token : rawRefreshToken;

  return json({
    accessToken,
    refreshToken: newRefreshToken,
    tokenExpiry: Date.now() + expiresIn * 1000,
  });
}
