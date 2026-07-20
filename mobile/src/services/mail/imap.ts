import {Buffer} from 'buffer';
import type {MailAccountConfig, MailAuthSecrets, MailMessageDetail, MailMessageSummary} from './types';
import {connectTlsLineClient, readTaggedOk, type TcpLineClient} from './tcpClient';
import {
  messageDetailFromRfc822,
  parseHeaderField,
  readFetchRfc822Source,
} from './imapFetchBody';
import {mailStub} from './mailTrace';

export {
  messageDetailFromRfc822,
  parseHeaderField,
  readFetchRfc822Source,
  type FetchBodyClient,
} from './imapFetchBody';

function xoauth2String(user: string, accessToken: string): string {
  const raw = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(raw, 'utf8').toString('base64');
}

export async function imapAuthenticate(
  client: TcpLineClient,
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  await mailStub('imap.greeting.wait', config.authType);
  const greeting = await client.readLine();
  if (!greeting.startsWith('* OK')) {
    await mailStub('imap.greeting.ok', `fail=${greeting.slice(0, 80)}`);
    throw new Error(`IMAP greeting failed: ${greeting}`);
  }
  await mailStub('imap.greeting.ok');
  const tag = 'a1';
  await mailStub(
    'imap.login.wait',
    config.authType === 'oauth' ? 'XOAUTH2' : 'LOGIN',
  );
  if (config.authType === 'oauth' && secrets.accessToken) {
    const blob = xoauth2String(config.username || secrets.imapPassword, secrets.accessToken);
    client.writeLine(`${tag} AUTHENTICATE XOAUTH2 ${blob}`);
  } else {
    client.writeLine(`${tag} LOGIN ${quoteImap(config.username)} ${quoteImap(secrets.imapPassword)}`);
  }
  await readTaggedOk(client, tag);
  await mailStub('imap.login.ok');
}

function quoteImap(value: string): string {
  if (!/[ "]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export async function listInboxMessages(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  limit = 30,
): Promise<MailMessageSummary[]> {
  await mailStub(
    'inbox.list.start',
    `${config.imapHost}:${config.imapPort}`,
  );
  const client = await connectTlsLineClient({
    host: config.imapHost,
    port: config.imapPort,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', 'INBOX');
    client.writeLine('a2 SELECT INBOX');
    await readTaggedOk(client, 'a2');
    await mailStub('imap.select.ok');
    const searchTag = 'a3';
    client.writeLine(`${searchTag} UID SEARCH ALL`);
    const searchLines = await readTaggedOk(client, searchTag);
    const uids: number[] = [];
    for (const line of searchLines) {
      const match = line.match(/\* SEARCH (.+)/);
      if (match) {
        for (const part of match[1].trim().split(/\s+/)) {
          const n = Number(part);
          if (Number.isFinite(n)) {
            uids.push(n);
          }
        }
      }
    }
    const recent = uids.slice(-limit).reverse();
    const out: MailMessageSummary[] = [];
    for (const uid of recent) {
      const fetchTag = `f${uid}`;
      client.writeLine(
        `${fetchTag} UID FETCH ${uid} (FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`,
      );
      const lines = await readTaggedOk(client, fetchTag);
      const blob = lines.join('\n');
      out.push({
        uid,
        subject: parseHeaderField(blob, 'Subject') || '(no subject)',
        from: parseHeaderField(blob, 'From') || '',
        date: parseHeaderField(blob, 'Date') || '',
        seen: /\FLAGS \([^)]*\\Seen/i.test(blob),
      });
    }
    await mailStub('inbox.list.done', `count=${out.length}`);
    return out;
  } finally {
    client.close();
  }
}

export async function fetchMessageDetail(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  uid: number,
): Promise<MailMessageDetail> {
  await mailStub('inbox.fetch.start', `uid=${uid}`);
  const client = await connectTlsLineClient({
    host: config.imapHost,
    port: config.imapPort,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', 'INBOX');
    client.writeLine('b2 SELECT INBOX');
    await readTaggedOk(client, 'b2');
    await mailStub('imap.select.ok');
    const fetchTag = 'b3';
    client.writeLine(`${fetchTag} UID FETCH ${uid} (BODY.PEEK[])`);
    await mailStub('tcp.readLine.wait', `tag=${fetchTag} body`);
    const source = await readFetchRfc822Source(client, fetchTag);
    await mailStub('tcp.readLine.ok', `tag=${fetchTag}`);
    const {extractTextFromMimeSource, extractEbpPayloadFromMime} = await import('./mime');
    const parsed = extractTextFromMimeSource(source);
    const ebpPayload = extractEbpPayloadFromMime(source);
    await mailStub('inbox.fetch.done', `uid=${uid}`);
    return messageDetailFromRfc822(uid, source, parsed, ebpPayload);
  } finally {
    client.close();
  }
}
