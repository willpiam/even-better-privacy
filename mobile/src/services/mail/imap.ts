import {Buffer} from 'buffer';
import type {MailAccountConfig, MailAuthSecrets, MailMessageDetail, MailMessageSummary} from './types';
import {
  connectMailLineClient,
  readTaggedOk,
  type TcpLineClient,
} from './tcpClient';
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

export function quoteImap(value: string): string {
  if (!/[ "]/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Clamp fetch limit to the GUI range 1–100. */
export function clampMailLimit(limit: number, fallback = 20): number {
  const n = Number(limit);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(100, Math.max(1, Math.floor(n)));
}

export type MailUidPage = {
  uids: number[];
  page: number;
  totalPages: number;
  total: number;
};

/**
 * Newest-first UID pagination matching GUI math in
 * gui/local-backend/routes.ts (search/UID path):
 * totalPages = ceil(total/limit), page = min(pageRaw, totalPages),
 * slice from the end of ascending UIDs.
 */
export function paginateUids(
  uidsAscending: number[],
  pageRaw: number,
  limitRaw: number,
): MailUidPage {
  const limit = clampMailLimit(limitRaw);
  const total = uidsAscending.length;
  if (total === 0) {
    return {uids: [], page: 1, totalPages: 1, total: 0};
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, Math.floor(pageRaw) || 1), totalPages);
  const sliceEnd = total - (page - 1) * limit;
  const sliceStart = Math.max(0, sliceEnd - limit);
  const slice = uidsAscending.slice(sliceStart, sliceEnd);
  return {
    uids: slice.reverse(),
    page,
    totalPages,
    total,
  };
}

export function buildUidSearchCommand(tag: string, search?: string): string {
  const q = (search ?? '').trim();
  if (!q) {
    return `${tag} UID SEARCH ALL`;
  }
  const escaped = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `${tag} UID SEARCH TEXT "${escaped}"`;
}

async function maybeImapStartTls(
  client: TcpLineClient,
  secure: boolean,
): Promise<void> {
  if (secure) {
    return;
  }
  await mailStub('imap.starttls.wait');
  const tag = 'a0';
  client.writeLine(`${tag} STARTTLS`);
  await readTaggedOk(client, tag);
  if (!client.startTls) {
    throw new Error('IMAP STARTTLS upgrade unavailable on this connection');
  }
  await client.startTls();
  await mailStub('imap.starttls.ok');
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
  await maybeImapStartTls(client, config.imapSecure);
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

function parseSearchUids(searchLines: string[]): number[] {
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
  return uids;
}

export type ListMailboxMessagesParams = {
  folder?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type ListMailboxMessagesResult = {
  messages: MailMessageSummary[];
  folder: string;
  page: number;
  totalPages: number;
  total: number;
};

export async function listMailboxMessages(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  params: ListMailboxMessagesParams = {},
): Promise<ListMailboxMessagesResult> {
  const folder = (params.folder ?? 'INBOX').trim() || 'INBOX';
  const limit = clampMailLimit(params.limit ?? 20);
  const pageRaw = params.page ?? 1;
  await mailStub(
    'inbox.list.start',
    `${config.imapHost}:${config.imapPort} folder=${folder}`,
  );
  const client = await connectMailLineClient({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', folder);
    client.writeLine(`a2 SELECT ${quoteImap(folder)}`);
    await readTaggedOk(client, 'a2');
    await mailStub('imap.select.ok');
    const searchTag = 'a3';
    client.writeLine(buildUidSearchCommand(searchTag, params.search));
    const searchLines = await readTaggedOk(client, searchTag);
    const uids = parseSearchUids(searchLines);
    const pageInfo = paginateUids(uids, pageRaw, limit);
    const out: MailMessageSummary[] = [];
    for (const uid of pageInfo.uids) {
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
    return {
      messages: out,
      folder,
      page: pageInfo.page,
      totalPages: pageInfo.totalPages,
      total: pageInfo.total,
    };
  } finally {
    client.close();
  }
}

/** @deprecated Prefer {@link listMailboxMessages} */
export async function listInboxMessages(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  limit = 30,
): Promise<MailMessageSummary[]> {
  const result = await listMailboxMessages(config, secrets, {
    folder: 'INBOX',
    limit,
    page: 1,
  });
  return result.messages;
}

export async function fetchMessageDetail(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  uid: number,
  folder = 'INBOX',
): Promise<MailMessageDetail> {
  const mailbox = folder.trim() || 'INBOX';
  await mailStub('inbox.fetch.start', `uid=${uid} folder=${mailbox}`);
  const client = await connectMailLineClient({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    await mailStub('imap.select.wait', mailbox);
    client.writeLine(`b2 SELECT ${quoteImap(mailbox)}`);
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
