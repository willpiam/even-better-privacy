// Username rules for EBP managed mailboxes (`username@<MAIL_DOMAIN>`).
// Shared by the key server, GUI, and mobile so client-side hints match
// server-side enforcement.

export const MAIL_USERNAME_MIN = 3;
export const MAIL_USERNAME_MAX = 30;
export const MAIL_PASSWORD_MIN = 16;
export const MAIL_PASSWORD_MAX = 128;

/** Path signed (but never stored) when resetting a managed mailbox password. */
export const MAIL_PASSWORD_RESET_PATH = "ebp-mail::password-reset";

export const RESERVED_MAIL_USERNAMES: ReadonlySet<string> = new Set([
  "abuse",
  "admin",
  "administrator",
  "billing",
  "dmarc",
  "ebp",
  "help",
  "hostmaster",
  "info",
  "mail",
  "mailer-daemon",
  "noc",
  "no-reply",
  "noreply",
  "postmaster",
  "root",
  "security",
  "support",
  "system",
  "webmaster",
  "www",
]);

export function normalizeMailUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export type MailUsernameCheck =
  | { ok: true; username: string }
  | { ok: false; username: string; reason: string };

export function validateMailUsername(raw: string): MailUsernameCheck {
  const username = normalizeMailUsername(raw);
  if (username.length < MAIL_USERNAME_MIN) {
    return { ok: false, username, reason: `Use at least ${MAIL_USERNAME_MIN} characters.` };
  }
  if (username.length > MAIL_USERNAME_MAX) {
    return { ok: false, username, reason: `Use at most ${MAIL_USERNAME_MAX} characters.` };
  }
  if (!/^[a-z0-9.-]+$/.test(username)) {
    return { ok: false, username, reason: "Use only letters, numbers, dots, and hyphens." };
  }
  if (!/^[a-z0-9]/.test(username) || !/[a-z0-9]$/.test(username)) {
    return { ok: false, username, reason: "Start and end with a letter or number." };
  }
  if (/[.-]{2}/.test(username)) {
    return { ok: false, username, reason: "Don't put two dots or hyphens in a row." };
  }
  if (RESERVED_MAIL_USERNAMES.has(username)) {
    return { ok: false, username, reason: "That name is reserved." };
  }
  return { ok: true, username };
}

export function buildMailPasswordResetDetail(
  email: string,
  passwordSha256Hex: string,
): string {
  return `${email.toLowerCase()}|${passwordSha256Hex}`;
}
