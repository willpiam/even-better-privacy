import type {MailMessageDetail} from './types';

export type FetchBodyClient = {
  readLine: () => Promise<string>;
  readBytes: (n: number) => Promise<string>;
};

const BODY_LITERAL_RE = /BODY(?:\.PEEK)?\[\] \{(\d+)\}\s*$/i;
const BODY_QUOTED_RE = /BODY(?:\.PEEK)?\[\] "((?:\\.|[^"\\])*)"/i;

export function parseHeaderField(blob: string, name: string): string {
  const re = new RegExp(`${name}:\\s*(.+)$`, 'im');
  const m = blob.match(re);
  return m ? m[1].trim() : '';
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
