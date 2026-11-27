import {validateMailUsername, type MailUsernameCheck} from '../../../../common/MailUsername';
import {DEFAULT_MAIL_ACCOUNT, type MailAccountRecord} from './types';

export {validateMailUsername};
export type {MailUsernameCheck};

export type MailEndpoint = {host: string; port: number; secure: boolean};

export type EbpSignupConfig =
  | {enabled: false}
  | {enabled: true; domain: string; imap: MailEndpoint; smtp: MailEndpoint};

export type EbpSignupResult = {
  email: string;
  login: string;
  fingerprint: string;
  imap: MailEndpoint;
  smtp: MailEndpoint;
};

function parseEndpoint(value: unknown): MailEndpoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (typeof v.host !== 'string' || !v.host || typeof v.port !== 'number') {
    return null;
  }
  return {host: v.host, port: v.port, secure: v.secure !== false};
}

/** Map `GET /api/v1/mail/signup/config` into a typed config; anything malformed is "disabled". */
export function parseSignupConfig(body: unknown): EbpSignupConfig {
  if (!body || typeof body !== 'object') {
    return {enabled: false};
  }
  const b = body as Record<string, unknown>;
  const imap = parseEndpoint(b.imap);
  const smtp = parseEndpoint(b.smtp);
  if (b.enabled !== true || typeof b.domain !== 'string' || !b.domain || !imap || !smtp) {
    return {enabled: false};
  }
  return {enabled: true, domain: b.domain, imap, smtp};
}

export function buildMailAddress(username: string, domain: string): string {
  return `${username.trim().toLowerCase()}@${domain.toLowerCase()}`;
}

export function buildSignupRequest(params: {
  fingerprint: string;
  username: string;
  mailPassword: string;
  detailProof: string;
}): string {
  return JSON.stringify({
    fingerprint: params.fingerprint,
    username: params.username.trim().toLowerCase(),
    mailPassword: params.mailPassword,
    detailProof: params.detailProof,
  });
}

export function parseSignupResponse(
  body: unknown,
  fallback: {email: string; fingerprint: string; config: EbpSignupConfig},
): EbpSignupResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email : fallback.email;
  const cfg = fallback.config.enabled ? fallback.config : null;
  const imap = parseEndpoint(b.imap) ?? cfg?.imap;
  const smtp = parseEndpoint(b.smtp) ?? cfg?.smtp;
  if (!imap || !smtp) {
    throw new Error('Mail server did not return connection settings');
  }
  return {
    email,
    login: typeof b.login === 'string' ? b.login : email,
    fingerprint: typeof b.fingerprint === 'string' ? b.fingerprint : fallback.fingerprint,
    imap,
    smtp,
  };
}

export function buildEbpMailAccountRecord(params: {
  id: string;
  result: EbpSignupResult;
  fromName?: string;
}): Omit<MailAccountRecord, 'createdAt' | 'updatedAt'> {
  const {result} = params;
  return {
    id: params.id,
    name: 'EBP Mail',
    config: {
      ...DEFAULT_MAIL_ACCOUNT,
      authType: 'password',
      imapHost: result.imap.host,
      imapPort: result.imap.port,
      imapSecure: result.imap.secure,
      smtpHost: result.smtp.host,
      smtpPort: result.smtp.port,
      smtpSecure: result.smtp.secure,
      username: result.login,
      fromEmail: result.email,
      fromName: params.fromName ?? '',
      persistSecrets: true,
    },
  };
}

/** Pick `count` distinct word positions (0-based, ascending) using `randomInt(max)`. */
export function pickQuizIndexes(
  count: number,
  total: number,
  randomInt: (max: number) => number,
): number[] {
  const n = Math.min(count, total);
  const picks = new Set<number>();
  while (picks.size < n) {
    picks.add(randomInt(total));
  }
  return [...picks].sort((a, b) => a - b);
}

export function quizMatches(
  mnemonic: string,
  answers: Record<number, string>,
  indexes: number[],
): boolean {
  const words = mnemonic.trim().split(/\s+/);
  return indexes.every(
    i => (answers[i] ?? '').trim().toLowerCase() === words[i],
  );
}

/** Choose a local identity name for the new key set that does not collide. */
export function chooseIdentityName(
  username: string,
  existing: string[],
  suffix: () => string,
): string {
  const taken = new Set(existing);
  for (const candidate of [username, `${username}-ebp`]) {
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  let candidate = `${username}-${suffix()}`;
  while (taken.has(candidate)) {
    candidate = `${username}-${suffix()}`;
  }
  return candidate;
}

export function isAddressTakenError(message: string): boolean {
  return /taken|already exists/i.test(message);
}

/** Signup 409 whose body says this identity already has a mailbox. */
export function isAlreadyHasMailboxError(message: string, status?: number): boolean {
  if (status !== undefined && status !== 409) {
    return false;
  }
  return /already has a mailbox/i.test(message);
}

export type OnboardingWizardStep =
  | 'welcome'
  | 'domain'
  | 'address'
  | 'password'
  | 'unlock'
  | 'phrase'
  | 'confirm'
  | 'create'
  | 'done';

/**
 * New identities set a password and confirm a recovery phrase.
 * An existing identity keeps the username step, unlocks with its password,
 * and skips the new-password, phrase, and confirm steps.
 */
export function wizardSteps(
  useExisting: boolean,
  testMailEnabled = false,
): OnboardingWizardStep[] {
  return [
    'welcome',
    ...(testMailEnabled ? ['domain' as const] : []),
    'address',
    ...(useExisting ? ['unlock' as const] : ['password' as const, 'phrase' as const, 'confirm' as const]),
    'create',
    'done',
  ];
}

/** True when `email` is exactly `local@domain` (domain match is exact, case-insensitive). */
export function isManagedMailAddress(email: string, domain: string): boolean {
  const addr = email.trim().toLowerCase();
  const dom = domain.trim().toLowerCase();
  if (!addr || !dom) {
    return false;
  }
  const at = addr.lastIndexOf('@');
  if (at <= 0 || at !== addr.indexOf('@') || at === addr.length - 1) {
    return false;
  }
  return addr.slice(at + 1) === dom;
}

/**
 * Message for a failed `GET /api/v1/identity/:fp` during mailbox restore.
 * Server failures stay distinct from a published identity that has no mailbox.
 */
export function managedEmailLookupError(status: number, domain: string): string {
  if (status >= 500) {
    return `Key server could not look up this mailbox (HTTP ${status}).`;
  }
  return `this identity has no verified @${domain.toLowerCase()} mailbox on the key server`;
}

/**
 * Verified `email` detail from `GET /api/v1/identity/:fp`, or null when missing,
 * revoked, unverified, or on a different domain.
 */
export function parseVerifiedManagedEmail(body: unknown, domain: string): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as {
    details?: Record<string, unknown>;
    detailsMeta?: Record<string, {verified?: boolean}>;
    revokedDetails?: unknown;
  };
  const revoked = Array.isArray(record.revokedDetails) ? record.revokedDetails : [];
  if (revoked.includes('email')) {
    return null;
  }
  if (record.detailsMeta?.email?.verified !== true) {
    return null;
  }
  const entry = record.details?.email;
  const raw = Array.isArray(entry)
    ? entry[0]
    : entry;
  if (typeof raw !== 'string' || !isManagedMailAddress(raw, domain)) {
    return null;
  }
  return raw.trim().toLowerCase();
}

export function buildMailPasswordResetRequest(params: {
  fingerprint: string;
  mailPassword: string;
  proof: string;
}): string {
  return JSON.stringify({
    fingerprint: params.fingerprint,
    mailPassword: params.mailPassword,
    proof: params.proof,
  });
}

export function buildMailDeleteRequest(params: {
  fingerprint: string;
  email?: string;
  proof: string;
}): string {
  return JSON.stringify({
    fingerprint: params.fingerprint,
    email: params.email,
    proof: params.proof,
  });
}

/** Typed confirmation must match the mailbox address exactly, ignoring case and surrounding space. */
export function mailboxDeleteConfirmed(email: string, typed: string): boolean {
  const expected = email.trim().toLowerCase();
  return expected.length > 0 && typed.trim().toLowerCase() === expected;
}

export function managedMailboxRestoreHint(email: string): string {
  return `This identity has a verified mailbox (${email}). Open the Mail tab and choose Restore mailbox access.`;
}

export const TEST_MAIL_DOMAIN = 'test.pqpost.com';
export const PRODUCTION_KEY_SERVER = 'https://keys.pqpost.com';
export const TEST_CHECKOUT_ORIGIN = 'https://test.pqpost.com';
export const MAIL_TEST_MODE_HEADER = 'x-ebp-mail-mode';
const TEST_PAYMENT_NETWORKS = new Set(['ethereum-sepolia', 'cardano-preview']);
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type PaymentAsset = {network: string; symbol: string};

export type UsernameAvailability = {
  available: boolean;
  username: string;
  reason?: string;
  purchasable: boolean;
  usdCents?: number;
};

export function parseUsernameAvailability(
  body: unknown,
  fallbackUsername: string,
): UsernameAvailability {
  const record = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const username = typeof record.username === 'string' && record.username
    ? record.username
    : fallbackUsername;
  const usdCents = record.usdCents;
  const purchasable = record.purchasable === true &&
    typeof usdCents === 'number' &&
    Number.isSafeInteger(usdCents) &&
    usdCents > 0;
  return {
    available: record.available === true,
    username,
    purchasable,
    ...(purchasable ? {usdCents} : {}),
    ...(typeof record.reason === 'string' && record.reason ? {reason: record.reason} : {}),
  };
}

/** Keep only Sepolia and Cardano preview. Mainnet assets are never offered here. */
export function parseTestPaymentAssets(body: unknown): PaymentAsset[] {
  const assets = (body && typeof body === 'object'
    ? (body as {assets?: unknown}).assets
    : null);
  if (!Array.isArray(assets)) return [];
  const seen = new Set<string>();
  const parsed: PaymentAsset[] = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') continue;
    const network = (asset as {network?: unknown}).network;
    const symbol = (asset as {symbol?: unknown}).symbol;
    if (typeof network !== 'string' || typeof symbol !== 'string') continue;
    if (!TEST_PAYMENT_NETWORKS.has(network) || !symbol) continue;
    const key = `${network}:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({network, symbol});
  }
  return parsed;
}

export function formatUsdPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)} USD`;
}

export type AddressChoice =
  | {kind: 'available'; username: string}
  | {kind: 'purchase'; username: string; usdCents: number; assets: PaymentAsset[]}
  | {kind: 'unavailable'; username: string; reason: string};

/**
 * Short-address sales in the app are test-only. Test mode must be on, the
 * server must be offering test.pqpost.com, and the assets must be test networks.
 */
export function mobileAddressChoice(input: {
  testMode: boolean;
  domain: string;
  availability: UsernameAvailability;
  assets: PaymentAsset[];
}): AddressChoice {
  const {availability} = input;
  if (availability.available) {
    return {kind: 'available', username: availability.username};
  }
  if (availability.purchasable && availability.usdCents) {
    if (!input.testMode) {
      return {
        kind: 'unavailable',
        username: availability.username,
        reason: 'Turn on test mail in Settings to buy a short test address.',
      };
    }
    if (input.domain !== TEST_MAIL_DOMAIN) {
      return {
        kind: 'unavailable',
        username: availability.username,
        reason: 'Short names can only be purchased for test.pqpost.com.',
      };
    }
    const assets = parseTestPaymentAssets({assets: input.assets});
    if (!assets.length) {
      return {
        kind: 'unavailable',
        username: availability.username,
        reason: 'Test-network payment is not available.',
      };
    }
    return {
      kind: 'purchase',
      username: availability.username,
      usdCents: availability.usdCents,
      assets,
    };
  }
  return {
    kind: 'unavailable',
    username: availability.username,
    reason: availability.reason || 'That address is taken.',
  };
}

export function testCheckoutUrl(server: string, orderId: string): string | null {
  if (!ORDER_ID.test(orderId)) return null;
  let origin = '';
  try {
    origin = new URL(server).origin;
  } catch {
    return null;
  }
  const checkoutOrigin = origin === 'http://127.0.0.1:8789'
    ? origin
    : origin === PRODUCTION_KEY_SERVER
      ? TEST_CHECKOUT_ORIGIN
      : '';
  if (!checkoutOrigin) return null;
  return `${checkoutOrigin}/checkout.html#${encodeURIComponent(orderId)}`;
}

export type CheckoutHandoff = {
  url: string;
  canOpenOnDevice: boolean;
  message: string;
};

export function checkoutHandoff(url: string): CheckoutHandoff {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '';
  }
  const local = host === '127.0.0.1' || host === 'localhost';
  return {
    url,
    canOpenOnDevice: !local && url.startsWith('https://'),
    message: local
      ? 'Open this checkout link on the computer running the test server. This phone cannot reach that computer’s localhost. Pay with test funds only, then come back and check payment.'
      : 'Open this checkout link on a computer, or paste it into your wallet app’s browser. Pay with test funds only. This does not buy a real address. Then come back and check payment.',
  };
}
