// Sent-mailbox discovery and sender-copy recipient sets.
// IMAP SPECIAL-USE \Sent (RFC 6154 / RFC 9051) is the mailbox clients should
// open. Providers name it differently: "Sent", "Sent Items", "[Gmail]/Sent Mail".

export const SENT_MAILBOX_ALIASES = [
  "Sent",
  "Sent Items",
  "Sent Messages",
  "[Gmail]/Sent Mail",
  "INBOX.Sent",
] as const;

export const DEFAULT_SENT_MAILBOX = "Sent";

export type MailboxListing = {
  path: string;
  flags?: Iterable<string>;
  specialUse?: string;
};

export function isSentFolderRequest(folder: string): boolean {
  const name = folder.trim().toLowerCase();
  if (!name) return false;
  if (name === "sent") return true;
  return SENT_MAILBOX_ALIASES.some((alias) => alias.toLowerCase() === name);
}

export function pickSentMailbox(
  mailboxes: readonly MailboxListing[],
): string | null {
  for (const box of mailboxes) {
    if ((box.specialUse ?? "").toLowerCase() === "\\sent") return box.path;
    const flags = box.flags ? [...box.flags] : [];
    if (flags.some((flag) => flag.toLowerCase() === "\\sent")) return box.path;
  }
  const byPath = new Map(
    mailboxes
      .filter((box) => box.path.length > 0)
      .map((box) => [box.path.toLowerCase(), box.path]),
  );
  for (const alias of SENT_MAILBOX_ALIASES) {
    const hit = byPath.get(alias.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Parse one untagged IMAP LIST line. Returns null when it is not a LIST row. */
export function parseImapListLine(
  line: string,
): { path: string; flags: string[] } | null {
  const header = line.trim().match(
    /^\* LIST \(([^)]*)\)\s+(\S+)\s+([\s\S]+)$/i,
  );
  if (!header) return null;
  const flags = header[1].split(/\s+/).filter((flag) => flag.length > 0);
  let mailbox = header[3].trim();
  if (mailbox.startsWith('"')) {
    const quoted = mailbox.match(/^"((?:\\.|[^"\\])*)"/);
    mailbox = quoted ? quoted[1].replace(/\\(.)/g, "$1") : "";
  } else {
    mailbox = mailbox.split(/\s+/)[0] ?? "";
  }
  if (!mailbox || mailbox.toUpperCase() === "NIL") return null;
  return { path: mailbox, flags };
}

/** Keep every recipient, and add the sender when their fingerprint is new. */
export function includeSenderAmongRecipients<T extends { fingerprint: string }>(
  recipients: readonly T[],
  sender: T,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const recipient of [...recipients, sender]) {
    const fingerprint = recipient.fingerprint;
    if (!fingerprint || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    out.push(recipient);
  }
  return out;
}
