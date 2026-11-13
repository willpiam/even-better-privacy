import {readMailboxHeaders} from './imapHeaders';
import {Buffer} from 'buffer';
import {
  DEFAULT_SENT_MAILBOX,
  isSentFolderRequest,
  parseImapListLine,
  pickSentMailbox,
} from '../../../../common/SentMailbox';
import type {
  MailAccountConfig,
  MailAuthSecrets,
  MailMessageDetail,
  MailMessageSummary,
} from './types';
import {
  connectMailLineClient,
  readTaggedOk,
  type TcpLineClient,
} from './tcpClient';
import {messageDetailFromRfc822, readFetchRfc822Source} from './imapFetchBody';
import {mailStub} from './mailTrace';

export {
  messageDetailFromRfc822,
  parseHeaderField,
  readFetchRfc822Source,
  type FetchBodyClient,
} from './imapFetchBody';

export function quoteImap(value: string): string {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127)
      throw new Error('IMAP strings cannot contain control characters');
  }
  if (value.length > 0 && !/[ (){%*"\\\]]/.test(value)) {
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
  return `${tag} UID SEARCH TEXT ${quoteImap(q)}`;
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
  await mailStub('imap.login.wait', 'LOGIN');
  client.writeLine(
    `${tag} LOGIN ${quoteImap(config.username)} ${quoteImap(
      secrets.imapPassword,
    )}`,
  );
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
  /** False when a Sent request did not match any mailbox on the server. */
  found: boolean;
};

function normalizeRfc822(mime: string): string {
  const crlf = mime.replace(/\r?\n/g, '\r\n');
  return crlf.endsWith('\r\n') ? crlf : `${crlf}\r\n`;
}

async function findSentMailbox(
  client: TcpLineClient,
  create: boolean,
): Promise<string | null> {
  client.writeLine('s1 LIST "" "*"');
  const lines = await readTaggedOk(client, 's1');
  const boxes = lines
    .map(line => parseImapListLine(line))
    .filter((box): box is {path: string; flags: string[]} => box !== null);
  const picked = pickSentMailbox(boxes);
  if (picked) {
    return picked;
  }
  if (!create) {
    return null;
  }
  client.writeLine(`s2 CREATE ${quoteImap(DEFAULT_SENT_MAILBOX)}`);
  await readTaggedOk(client, 's2');
  return DEFAULT_SENT_MAILBOX;
}

async function readAppendContinuation(client: TcpLineClient): Promise<void> {
  let line = await client.readLine();
  while (line.startsWith('*')) {
    line = await client.readLine();
  }
  if (!line.startsWith('+')) {
    throw new Error(`IMAP APPEND rejected: ${line}`);
  }
}

/** Save a copy of an outbound RFC822 message in the Sent mailbox. */
export async function appendSentCopy(
  config: MailAccountConfig,
  secrets: MailAuthSecrets,
  mime: string,
): Promise<string> {
  await mailStub('sent.append.start', config.imapHost);
  const client = await connectMailLineClient({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
  });
  try {
    await imapAuthenticate(client, config, secrets);
    const mailbox = await findSentMailbox(client, true);
    if (!mailbox) {
      throw new Error('Sent mailbox not found');
    }
    const payload = normalizeRfc822(mime);
    const octets = Buffer.byteLength(payload, 'utf8');
    client.writeLine(`s3 APPEND ${quoteImap(mailbox)} (\\Seen) {${octets}}`);
    await readAppendContinuation(client);
    client.writeBytes(payload);
    // The octet count covers only the message. IMAP still needs a CRLF
    // after the literal to finish the APPEND command.
    client.writeBytes('\r\n');
    await readTaggedOk(client, 's3');
    await mailStub('sent.append.done', mailbox);
    return mailbox;
  } finally {
    client.close();
  }
}

async function selectMailbox(
  client: TcpLineClient,
  folder: string,
  selectTag: string,
): Promise<string | null> {
  let opened = folder;
  if (isSentFolderRequest(folder)) {
    const picked = await findSentMailbox(client, false);
    if (!picked) {
      return null;
    }
    opened = picked;
  }
  await mailStub('imap.select.wait', opened);
  client.writeLine(`${selectTag} SELECT ${quoteImap(opened)}`);
  await readTaggedOk(client, selectTag);
  await mailStub('imap.select.ok');
  return opened;
}

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
    const opened = await selectMailbox(client, folder, 'a2');
    if (!opened) {
      return {
        messages: [],
        folder,
        page: 1,
        totalPages: 1,
        total: 0,
        found: false,
      };
    }
    const searchTag = 'a3';
    client.writeLine(buildUidSearchCommand(searchTag, params.search));
    const searchLines = await readTaggedOk(client, searchTag);
    const uids = parseSearchUids(searchLines);
    const pageInfo = paginateUids(uids, pageRaw, limit);
    let out: MailMessageSummary[] = [];
    if (pageInfo.uids.length) {
      client.writeLine(
        `a4 UID FETCH ${pageInfo.uids.join(
          ',',
        )} (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])`,
      );
      out = await readMailboxHeaders(client, 'a4', pageInfo.uids);
    }
    await mailStub('inbox.list.done', `count=${out.length}`);
    return {
      messages: out,
      folder: opened,
      page: pageInfo.page,
      totalPages: pageInfo.totalPages,
      total: pageInfo.total,
      found: true,
    };
  } finally {
    client.close();
  }
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
    const opened = await selectMailbox(client, mailbox, 'b2');
    if (!opened) {
      throw new Error('Sent mailbox not found');
    }
    const fetchTag = 'b3';
    client.writeLine(`${fetchTag} UID FETCH ${uid} (BODY.PEEK[])`);
    await mailStub('tcp.readLine.wait', `tag=${fetchTag} body`);
    const source = await readFetchRfc822Source(client, fetchTag);
    await mailStub('tcp.readLine.ok', `tag=${fetchTag}`);
    const {parseMimeMessage} = await import('./mime');
    const parsed = parseMimeMessage(source);
    const {ebpPayload} = parsed;
    await mailStub('inbox.fetch.done', `uid=${uid}`);
    return messageDetailFromRfc822(uid, source, parsed, ebpPayload);
  } finally {
    client.close();
  }
}
