import {splitHeadersAndBody} from "../../../../common/mail/Headers.ts";
import {taggedImapStatus} from "../../../../common/mail/ImapStatus.ts";
import type {MailMessageDetail} from './types';
import {Buffer} from 'buffer';
import {MAX_MAIL_SOURCE_BYTES} from '../../../../common/MailLimits';
import {decodeHeaderWords} from './headerWords';

export type FetchBodyClient = {
  readLine: () => Promise<string>;
  readBytes: (n: number) => Promise<Uint8Array>;
};

const BODY_LITERAL_RE = /BODY(?:\.PEEK)?\[\] \{(\d+)\}\s*$/i;
const BODY_QUOTED_RE = /BODY(?:\.PEEK)?\[\] "((?:\\.|[^"\\])*)"/i;

/**
 * Return only the RFC822 header block (before the first blank line).
 * Searching the full source lets body text / armor falsely match header names
 * (e.g. a line containing `from:to:cc:...`).
 */
export function rfc822HeaderBlock(source: string): string {
  return splitHeadersAndBody(source).headerBlock;
}
export function parseHeaderField(blob: string | Uint8Array, name: string): string {
  const value = splitHeadersAndBody(typeof blob === 'string' ? blob : Buffer.from(blob).toString('utf8')).headers[name.toLowerCase()] ?? '';
  return name.toLowerCase() === 'subject' ? decodeHeaderWords(value) : value;
}

/**
 * Read a UID FETCH BODY.PEEK[] / BODY[] response until the tagged OK,
 * returning the RFC822 source from a `{n}` literal or quoted string.
 */
export async function readFetchRfc822Source(
  client: FetchBodyClient,
  fetchTag: string,
): Promise<Uint8Array> {
  let rfc822 = new Uint8Array();
  let totalBytes = 0;
  while (true) {
    const line = await client.readLine();
    if (line.startsWith(`${fetchTag} `)) {
      if (taggedImapStatus(line, fetchTag) !== 'OK') {
        throw new Error(line);
      }
      break;
    }
    const lit = line.match(BODY_LITERAL_RE);
    if (lit) {
      const n = Number(lit[1]);
      if (
        !Number.isSafeInteger(n) ||
        n < 0 ||
        totalBytes + n > MAX_MAIL_SOURCE_BYTES
      ) {
        throw new Error('Mail message exceeds size limit');
      }
      totalBytes += n;
      rfc822 = new Uint8Array(await client.readBytes(n));
      continue;
    }
    const quoted = line.match(BODY_QUOTED_RE);
    if (quoted) {
      totalBytes += Buffer.byteLength(quoted[1], 'utf8');
      if (totalBytes > MAX_MAIL_SOURCE_BYTES)
        throw new Error('Mail message exceeds size limit');
      rfc822 = Buffer.from(quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'), 'latin1');
    }
  }
  if (!rfc822.length) {
    throw new Error('FETCH response contained no BODY[] payload');
  }
  return rfc822;
}

/**
 * Build MailMessageDetail fields from an RFC822 source string.
 */
export function messageDetailFromRfc822(
  uid: number,
  source: string | Uint8Array,
  parsed: {text: string; html: string},
  ebpPayload: string | null,
): MailMessageDetail {
  const rawSource = typeof source === 'string' ? source : Buffer.from(source).toString('utf8');
  const headers = splitHeadersAndBody(rawSource).headers;
  return {
    uid,
    subject: decodeHeaderWords(headers['subject'] ?? '') || '',
    from: headers['from'] || '',
    to: headers['to'] || '',
    date: headers['date'] || '',
    bodyText: parsed.text,
    bodyHtml: parsed.html,
    rawSource,
    ebpPayload,
  };
}
