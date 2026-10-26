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
