import {Linking} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {getServerUrl} from '../settings';
import {
  MAIL_OAUTH_REDIRECT_URI,
  type MailOauthProvider,
} from './types';

const PENDING_KEY = 'ebp.mail.oauth.pending';

export type MailOauthServerProviderConfig = {
  clientId: string;
  configured: boolean;
};

export type MailOauthServerConfig = Record<
  Exclude<MailOauthProvider, ''>,
  MailOauthServerProviderConfig
>;

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

/** Public OAuth client IDs (same as GUI env defaults when unset). */
const PROVIDERS: Record<Exclude<MailOauthProvider, ''>, OAuthProviderConfig> = {
  gmail: {
    clientId: '',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    scopes: ['https://mail.google.com/', 'openid', 'email'],
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
  },
  outlook: {
    clientId: '',
    authUrl:
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    scopes: [
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
      'offline_access',
      'openid',
      'email',
    ],
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
  },
};

function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export function getOAuthProviderConfig(
  provider: Exclude<MailOauthProvider, ''>,
): OAuthProviderConfig {
  return PROVIDERS[provider];
}

function parseServerProviderConfig(
  value: unknown,
): MailOauthServerProviderConfig {
  if (!value || typeof value !== 'object') {
    return {clientId: '', configured: false};
  }
  const record = value as Record<string, unknown>;
  const clientId = typeof record.clientId === 'string' ? record.clientId : '';
  const configured =
    typeof record.configured === 'boolean'
      ? record.configured
      : clientId.length > 0;
  return {clientId, configured};
}

export async function fetchMailOAuthConfig(
  serverUrl: string,
): Promise<MailOauthServerConfig> {
  const res = await fetch(apiUrl(serverUrl, '/api/v1/mail/oauth/config'));
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`Failed to load mail OAuth config: ${reason}`);
  }
  const providers = body.providers;
  if (!providers || typeof providers !== 'object') {
    throw new Error('Failed to load mail OAuth config: invalid response');
  }
  const map = providers as Record<string, unknown>;
  return {
    gmail: parseServerProviderConfig(map.gmail),
    outlook: parseServerProviderConfig(map.outlook),
  };
}

export function resolveOAuthClientId(
  provider: Exclude<MailOauthProvider, ''>,
  serverConfig: MailOauthServerConfig,
  override?: string,
): string {
  const trimmedOverride = override?.trim() ?? '';
  if (trimmedOverride) {
    return trimmedOverride;
  }
  const fromServer = serverConfig[provider]?.clientId?.trim() ?? '';
  if (fromServer) {
    return fromServer;
  }
  throw new Error(
    `OAuth client ID for ${provider} is not configured on the key server`,
  );
}

export async function startMailOAuth(
  provider: Exclude<MailOauthProvider, ''>,
  clientId?: string,
): Promise<{state: string; authUrl: string}> {
  const state = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  await AsyncStorage.setItem(
    PENDING_KEY,
    JSON.stringify({state, provider, createdAt: Date.now()}),
  );
  const cfg = getOAuthProviderConfig(provider);
  const id = clientId?.trim() || cfg.clientId;
  if (!id) {
    throw new Error(
      'OAuth client ID required (configure on key server or in Settings → Advanced)',
    );
  }
  const url = new URL(cfg.authUrl);
  url.searchParams.set('client_id', id);
  url.searchParams.set('redirect_uri', MAIL_OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', cfg.scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return {state, authUrl: url.toString()};
}

export async function openMailOAuthBrowser(authUrl: string): Promise<void> {
  const can = await Linking.canOpenURL(authUrl);
  if (!can) {
    throw new Error('Cannot open OAuth URL');
  }
  await Linking.openURL(authUrl);
}

export async function completeMailOAuthFromUrl(
  callbackUrl: string,
): Promise<{
  provider: Exclude<MailOauthProvider, ''>;
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
  email: string;
}> {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    throw new Error('OAuth callback missing code or state');
  }
  const pendingRaw = await AsyncStorage.getItem(PENDING_KEY);
  if (!pendingRaw) {
    throw new Error('No pending OAuth session');
  }
  const pending = JSON.parse(pendingRaw) as {
    state: string;
    provider: Exclude<MailOauthProvider, ''>;
  };
  if (pending.state !== state) {
    throw new Error('OAuth state mismatch');
  }
  await AsyncStorage.removeItem(PENDING_KEY);
  const server = await getServerUrl();
  const res = await fetch(apiUrl(server, '/api/v1/mail/oauth/exchange'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      provider: pending.provider,
      code,
      redirectUri: MAIL_OAUTH_REDIRECT_URI,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`OAuth exchange failed: ${reason}`);
  }
  return {
    provider: pending.provider,
    accessToken: String(body.accessToken ?? ''),
    refreshToken: String(body.refreshToken ?? ''),
    tokenExpiry: Number(body.tokenExpiry ?? Date.now() + 3600_000),
    email: String(body.email ?? ''),
  };
}

export async function refreshMailOAuthToken(params: {
  provider: Exclude<MailOauthProvider, ''>;
  refreshToken: string;
}): Promise<{
  accessToken: string;
  refreshToken: string;
  tokenExpiry: number;
}> {
  const server = await getServerUrl();
  const res = await fetch(apiUrl(server, '/api/v1/mail/oauth/refresh'), {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify({
      provider: params.provider,
      refreshToken: params.refreshToken,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new Error(`OAuth refresh failed: ${reason}`);
  }
  return {
    accessToken: String(body.accessToken ?? ''),
    refreshToken: String(body.refreshToken ?? params.refreshToken),
    tokenExpiry: Number(body.tokenExpiry ?? Date.now() + 3600_000),
  };
}

export function subscribeMailOAuthCallbacks(
  handler: (url: string) => void,
): () => void {
  const sub = Linking.addEventListener('url', event => {
    if (event.url.startsWith(MAIL_OAUTH_REDIRECT_URI.split('?')[0])) {
      handler(event.url);
    }
  });
  return () => sub.remove();
}
