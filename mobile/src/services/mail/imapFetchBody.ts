import type {MailMessageDetail} from './types';

export type FetchBodyClient = {
  readLine: () => Promise<string>;
  readBytes: (n: number) => Promise<string>;
};

const BODY_LITERAL_RE = /BODY(?:\.PEEK)?\[\] \{(\d+)\}\s*$/i;
const BODY_QUOTED_RE = /BODY(?:\.PEEK)?\[\] "((?:\\.|[^"\\])*)"/i;

/**
 * Return only the RFC822 header block (before the first blank line).
 * Searching the full source lets body text / armor falsely match header names
 * (e.g. a line containing `from:to:cc:...`).
 */
export function rfc822HeaderBlock(source: string): string {
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const idx = normalized.search(/\n\n/);
  if (idx < 0) {
    return normalized;
  }
  return normalized.slice(0, idx);
}

/**
 * Parse a header field from an RFC822 message or header-only blob.
 * Matches only at the start of a line within the header section and unfolds
 * RFC 5322 continuation lines.
 */
export function parseHeaderField(blob: string, name: string): string {
  const headers = rfc822HeaderBlock(blob);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}:\\s*(.*)$`, 'im');
  const m = headers.match(re);
  if (!m || m.index === undefined) {
    return '';
  }
  let value = m[1] ?? '';
  // Unfold continuation lines that follow the matched header line.
  const after = headers.slice(m.index + m[0].length);
  const cont = after.match(/^(?:\n[ \t]+(.*))+/);
  if (cont) {
    const parts = cont[0].split(/\n[ \t]+/).filter(Boolean);
    value = [value, ...parts].join(' ').replace(/\s+/g, ' ').trim();
  } else {
    value = value.trim();
  }
  return value;
}

/**
 * Read a UID FETCH BODY.PEEK[] / BODY[] response until the tagged OK,
 * returning the RFC822 source from a `{n}` literal or quoted string.
 */
export async function readFetchRfc822Source(
  client: FetchBodyClient,
  fetchTag: string,
): Promise<string> {
  let rfc822 = '';
  while (true) {
    const line = await client.readLine();
    if (line.startsWith(`${fetchTag} `)) {
      if (!line.includes(' OK')) {
        throw new Error(line);
      }
      break;
    }
    const lit = line.match(BODY_LITERAL_RE);
    if (lit) {
      const n = Number(lit[1]);
      rfc822 = await client.readBytes(n);
      continue;
    }
    const quoted = line.match(BODY_QUOTED_RE);
    if (quoted) {
      rfc822 = quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  if (!rfc822) {
    throw new Error('FETCH response contained no BODY[] payload');
  }
  return rfc822;
}

/**
 * Build MailMessageDetail fields from an RFC822 source string.
 */
export function messageDetailFromRfc822(
  uid: number,
  source: string,
  parsed: {text: string; html: string},
  ebpPayload: string | null,
): MailMessageDetail {
  return {
    uid,
    subject: parseHeaderField(source, 'Subject') || '',
    from: parseHeaderField(source, 'From') || '',
    to: parseHeaderField(source, 'To') || '',
    date: parseHeaderField(source, 'Date') || '',
    bodyText: parsed.text,
    bodyHtml: parsed.html,
    rawSource: source,
    ebpPayload,
  };
}
