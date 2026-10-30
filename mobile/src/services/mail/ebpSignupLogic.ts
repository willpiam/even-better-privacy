import {validateMailUsername, type MailUsernameCheck} from '../../../../core/MailUsername';
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
export function wizardSteps(useExisting: boolean): OnboardingWizardStep[] {
  if (useExisting) {
    return ['welcome', 'address', 'unlock', 'create', 'done'];
  }
  return ['welcome', 'address', 'password', 'phrase', 'confirm', 'create', 'done'];
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
  proof: string;
}): string {
  return JSON.stringify({
    fingerprint: params.fingerprint,
    proof: params.proof,
  });
}

/** Typed confirmation must match the mailbox address exactly, ignoring case and surrounding space. */
export function mailboxDeleteConfirmed(email: string, typed: string): boolean {
  const expected = email.trim().toLowerCase();
  return expected.length > 0 && typed.trim().toLowerCase() === expected;
}

export function managedMailboxRestoreHint(email: string): string {
  return `This identity has a verified mailbox (${email}). Mailbox access can be restored from Mail accounts.`;
}
