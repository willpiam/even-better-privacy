import {
  fetchContactFromServer,
  listContacts,
  loadContact,
} from '../contacts';
import {parseHeaderField} from './imapFetchBody';
import {
  extractEmailAddress,
  type MailAuthenticitySummary,
} from './mailAuthenticity';

export {extractEmailAddress};

/** Keep an existing Re: prefix; otherwise prepend `Re: `. */
export function formatReplySubject(subject: string): string {
  const trimmed = (subject || '').trim();
  if (!trimmed) {
    return 'Re: (no subject)';
  }
  if (/^re:\s*/i.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

/** Quote the original body for a reply draft. */
export function formatQuotedBody(params: {
  from: string;
  date?: string;
  body: string;
}): string {
  const from = params.from.trim() || 'unknown';
  const when = (params.date || '').trim();
  const header = when
    ? `On ${when}, ${from} wrote:`
    : `On ${from} wrote:`;
  const quoted = (params.body || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
  return `\n\n${header}\n${quoted}`;
}

/** Parse Message-ID from RFC822 source (empty if absent). */
export function parseMessageId(rawSource: string): string {
  return parseHeaderField(rawSource, 'Message-ID').trim();
}

/**
 * Resolve the EBP contact to encrypt a reply for, from decrypt authenticity.
 * Prefers a known local contact; otherwise loads by fingerprint or fetches
 * from the server and imports.
 */
export async function resolveReplyRecipientContact(
  authenticity: MailAuthenticitySummary | null,
): Promise<string | null> {
  if (!authenticity) {
    return null;
  }
  if (authenticity.isKnownContact && authenticity.contactName) {
    return authenticity.contactName;
  }
  const fingerprint = authenticity.signerFingerprint?.trim();
  if (!fingerprint) {
    return null;
  }
  try {
    const contacts = await listContacts();
    const named = contacts.find(c => c.contact.fingerprint === fingerprint);
    if (named) {
      return named.name;
    }
  } catch {
    // Fall through to loadContact / server fetch.
  }
  try {
    await loadContact(fingerprint);
    const contacts = await listContacts();
    const named = contacts.find(c => c.contact.fingerprint === fingerprint);
    if (named) {
      return named.name;
    }
  } catch {
    // Not local — try server.
  }
  try {
    const imported = await fetchContactFromServer({fingerprint});
    return imported.name;
  } catch {
    return null;
  }
}
