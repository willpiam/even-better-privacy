import {Buffer} from 'buffer';
import type {MailAccountConfig, MailAuthSecrets, MailMessageDetail, MailMessageSummary} from './types';
import {connectTlsLineClient, readTaggedOk, type TcpLineClient} from './tcpClient';

function xoauth2String(user: string, accessToken: string): string {
  const raw = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(raw, 'utf8').toString('base64');
}

async function imapAuthenticate(
  client: TcpLineClient,
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
): Promise<void> {
  const greeting = await client.readLine();
  if (!greeting.startsWith('* OK')) {
    throw new Error(`IMAP greeting failed: ${greeting}`);
  }
  const tag = 'a1';
  if (config.authType === 'oauth' && secrets.accessToken) {
    const blob = xoauth2String(config.username || secrets.imapPassword, secrets.accessToken);
    client.writeLine(`${tag} AUTHENTICATE XOAUTH2 ${blob}`);
  } else {
    client.writeLine(`${tag} LOGIN ${quoteImap(config.username)} ${quoteImap(secrets.imapPassword)}`);
  }
  await readTaggedOk(client, tag);
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
  const client = await connectTlsLineClient({
    host: config.imapHost,
    port: config.imapPort,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    client.writeLine('a2 SELECT INBOX');
    await readTaggedOk(client, 'a2');
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
    return out;
  } finally {
    client.close();
  }
}

function parseHeaderField(blob: string, name: string): string {
  const re = new RegExp(`${name}:\\s*(.+)$`, 'im');
  const m = blob.match(re);
  return m ? m[1].trim() : '';
}

export async function fetchMessageDetail(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  uid: number,
): Promise<MailMessageDetail> {
  const client = await connectTlsLineClient({
    host: config.imapHost,
    port: config.imapPort,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    client.writeLine('b2 SELECT INBOX');
    await readTaggedOk(client, 'b2');
    const fetchTag = 'b3';
    client.writeLine(`${fetchTag} UID FETCH ${uid} (BODY.PEEK[])`);
    const lines: string[] = [];
    let raw = '';
    while (true) {
      const line = await client.readLine();
      lines.push(line);
      if (line.startsWith(`${fetchTag} `)) {
        if (!line.includes(' OK')) {
          throw new Error(line);
        }
        break;
      }
      if (line.startsWith('* ')) {
        raw += `${line}\n`;
      }
    }
    const bodyMatch = raw.match(/BODY\[\] \{(\d+)\}/);
    const source = bodyMatch ? raw : lines.join('\n');
    const {text, html} = extractBodyFromFetch(source);
    const {extractTextFromMimeSource, extractEbpPayloadFromMime} = await import('./mime');
    const parsed = extractTextFromMimeSource(text || source);
    const ebpPayload = extractEbpPayloadFromMime(source);
    return {
      uid,
      subject: parseHeaderField(source, 'Subject') || '',
      from: parseHeaderField(source, 'From') || '',
      to: parseHeaderField(source, 'To') || '',
      date: parseHeaderField(source, 'Date') || '',
      bodyText: parsed.text,
      bodyHtml: parsed.html || html,
      rawSource: source,
      ebpPayload,
    };
  } finally {
    client.close();
  }
}

function extractBodyFromFetch(raw: string): {text: string; html: string} {
  const idx = raw.indexOf('\r\n\r\n');
  if (idx < 0) {
    return {text: raw, html: ''};
  }
  return {text: raw.slice(idx + 4), html: ''};
}
