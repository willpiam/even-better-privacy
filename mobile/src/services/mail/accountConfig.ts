import {
  DEFAULT_MAIL_ACCOUNT,
  type MailAccountConfig,
} from './types';

export function clampPort(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1 || n > 65535) {
    return fallback;
  }
  return Math.floor(n);
}

function toSafeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export type ManualMailConfigInput = Partial<MailAccountConfig>;

export function normalizeManualMailConfig(
  base: MailAccountConfig,
  payload: ManualMailConfigInput,
): MailAccountConfig {
  const next: MailAccountConfig = {
    gmailMode: false,
    authType: 'password',
    oauthProvider: '',
    imapHost: toSafeString(payload.imapHost ?? base.imapHost),
    imapPort: clampPort(payload.imapPort ?? base.imapPort, 993),
    imapSecure: asBool(payload.imapSecure, base.imapSecure),
    smtpHost: toSafeString(payload.smtpHost ?? base.smtpHost),
    smtpPort: clampPort(payload.smtpPort ?? base.smtpPort, 465),
    smtpSecure: asBool(payload.smtpSecure, base.smtpSecure),
    username: toSafeString(payload.username ?? base.username),
    fromEmail: toSafeString(payload.fromEmail ?? base.fromEmail),
    fromName: toSafeString(payload.fromName ?? base.fromName),
    persistSecrets: asBool(payload.persistSecrets, base.persistSecrets),
  };
  if (!next.imapHost || !next.smtpHost || !next.username || !next.fromEmail) {
    throw new Error('IMAP host, SMTP host, username, and from email are required');
  }
  return next;
}

export function validateManualSecrets(
  imapPassword: string,
  smtpPassword: string,
  isNew: boolean,
  hasExistingSecrets: boolean,
): void {
  if (isNew) {
    if (!imapPassword || !smtpPassword) {
      throw new Error('IMAP and SMTP passwords are required');
    }
    return;
  }
  if (!imapPassword && !smtpPassword && !hasExistingSecrets) {
    throw new Error('IMAP and SMTP passwords are required');
  }
  if ((imapPassword && !smtpPassword && !hasExistingSecrets) ||
      (!imapPassword && smtpPassword && !hasExistingSecrets)) {
    throw new Error('Both IMAP and SMTP passwords are required when changing credentials');
  }
}

export function newManualAccountDefaults(): MailAccountConfig {
  return {
    ...DEFAULT_MAIL_ACCOUNT,
    authType: 'password',
    persistSecrets: true,
    imapPort: 993,
    imapSecure: true,
    smtpPort: 465,
    smtpSecure: true,
  };
}
