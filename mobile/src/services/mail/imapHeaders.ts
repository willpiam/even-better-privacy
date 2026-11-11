import type {FetchBodyClient} from './imapFetchBody';
import {parseHeaderField} from './imapFetchBody';
import type {MailMessageSummary} from './types';

/** Read a batch FETCH using literal byte lengths, not header-shaped protocol lines. */
export async function readHeaderRecords(
  client: FetchBodyClient,
  tag: string,
  uids: number[],
): Promise<{uid: number; headers: string; seen: boolean}[]> {
  const messages = new Map<
    number,
    {uid: number; headers: string; seen: boolean}
  >();
  let metadata = '';
  let headers = '';
  const finish = () => {
    const uid = Number(metadata.match(/\bUID (\d+)/i)?.[1]);
    if (uid && headers) {
      messages.set(uid, {
        uid,
        headers,
        seen: /\bFLAGS \([^)]*\\Seen(?:\s|\))/i.test(metadata),
      });
    }
    metadata = '';
    headers = '';
  };
  while (true) {
    const line = await client.readLine();
    if (line.startsWith(`${tag} `)) {
      if (!new RegExp(`^${tag} OK(?: |$)`, 'i').test(line))
        throw new Error(line);
      finish();
      break;
    }
    if (/^\* \d+ FETCH \(/i.test(line)) finish();
    // Ignore unsolicited EXISTS/EXPUNGE responses between FETCH records.
    if (/^\* /i.test(line) && !/^\* \d+ FETCH \(/i.test(line)) continue;
    metadata += ` ${line}`;
    const literal = line.match(/\{(\d+)\}\s*$/);
    if (literal) {
      const text = await client.readBytes(Number(literal[1]));
      if (/BODY(?:\.PEEK)?\[HEADER\.FIELDS\b/i.test(line)) headers = text;
    }
  }
  // Servers may return ascending UID order, or omit a message deleted meanwhile.
  return uids.flatMap(uid => {
    const message = messages.get(uid);
    return message ? [message] : [];
  });
}

export async function readMailboxHeaders(
  client: FetchBodyClient,
  tag: string,
  uids: number[],
): Promise<MailMessageSummary[]> {
  const records = await readHeaderRecords(client, tag, uids);
  return records.map(({uid, headers, seen}) => ({
    uid,
    seen,
    subject: parseHeaderField(headers, 'Subject') || '(no subject)',
    from: parseHeaderField(headers, 'From'),
    to: parseHeaderField(headers, 'To'),
    date: parseHeaderField(headers, 'Date'),
  }));
}
