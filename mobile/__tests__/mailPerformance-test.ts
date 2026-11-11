jest.mock('../src/services/mail/tcpClient', () => ({
  connectMailLineClient: jest.fn(),
  readTaggedOk: jest.fn(),
}));
jest.mock('../src/services/mail/mailTrace', () => ({mailStub: jest.fn()}));

import {readMailboxHeaders} from '../src/services/mail/imapHeaders';
import {
  createMailCache,
  clearMailDataCache,
} from '../src/services/mail/mailCache';
import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';
import {
  getCachedMailPage,
  refreshMailPage,
  loadMailMessage,
} from '../src/services/mail/mailData';
import * as imap from '../src/services/mail/imap';
import {
  connectMailLineClient,
  readTaggedOk,
} from '../src/services/mail/tcpClient';

const secrets = {imapPassword: 'test', smtpPassword: 'test'};
const context = {
  account: {
    id: 'account',
    name: 'Test',
    createdAt: 1,
    updatedAt: 1,
    config: DEFAULT_MAIL_ACCOUNT,
  },
  secrets,
};
afterEach(() => {
  clearMailDataCache();
  jest.restoreAllMocks();
});

function headerClient(lines: string[], literals: string[]) {
  return {
    readLine: jest.fn(async () => {
      if (!lines.length) throw new Error('Unexpected read');
      return lines.shift()!;
    }),
    readBytes: jest.fn(async () => literals.shift()!),
  };
}

test('batch headers preserve UID order, literal boundaries and flags after the literal', async () => {
  const client = headerClient(
    [
      '* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)] {79}',
      ' UID 10 FLAGS (\\Seen))',
      '* 99 EXISTS',
      '* 2 FETCH (UID 20 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)] {52}',
      ')',
      'a4 OK Done',
    ],
    [
      'Subject: Old\r\nFrom: sender@example.com\r\n\r\n',
      'Subject: FLAGS (\\Seen)\r\nFrom: Other\r\n\r\n',
    ],
  );
  const messages = await readMailboxHeaders(client, 'a4', [30, 20, 10]);
  expect(messages.map(m => m.uid)).toEqual([20, 10]);
  expect(messages.map(m => m.seen)).toEqual([false, true]);
  expect(messages[1].from).toBe('sender@example.com');
  expect(client.readBytes.mock.calls).toEqual([[79], [52]]);
});

test('batch headers propagate server errors', async () => {
  await expect(
    readMailboxHeaders(headerClient(['a4 NO cannot fetch'], []), 'a4', [1]),
  ).rejects.toThrow('cannot fetch');
});

test('a page uses one header FETCH instead of one FETCH per message', async () => {
  const client = {
    ...headerClient(
      [
        '* 1 FETCH (UID 1 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)] {12}',
        ')',
        '* 2 FETCH (UID 2 FLAGS () BODY[HEADER.FIELDS (SUBJECT FROM TO DATE)] {12}',
        ')',
        'a4 OK Done',
      ],
      ['Subject: One\r\n\r\n', 'Subject: Two\r\n\r\n'],
    ),
    writeLine: jest.fn(),
    close: jest.fn(),
  };
  (connectMailLineClient as jest.Mock).mockResolvedValue(client);
  client.readLine.mockResolvedValueOnce('* OK Ready');
  (readTaggedOk as jest.Mock).mockImplementation(async (_client, tag) =>
    tag === 'a3' ? ['* SEARCH 1 2'] : [],
  );
  const result = await imap.listMailboxMessages(DEFAULT_MAIL_ACCOUNT, secrets);
  expect(result.messages.map(m => m.subject)).toEqual(['Two', 'One']);
  expect(
    client.writeLine.mock.calls.filter(([line]) => line.includes('UID FETCH')),
  ).toEqual([
    [
      'a4 UID FETCH 2,1 (UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM TO DATE)])',
    ],
  ]);
  expect(client.close).toHaveBeenCalledTimes(1);
});

test('cache coalesces concurrent work and does not repopulate after invalidation', async () => {
  const cache = createMailCache<string>(2, 100, 1000);
  let finish!: (value: string) => void;
  const fetcher = jest.fn(
    () =>
      new Promise<string>(resolve => {
        finish = resolve;
      }),
  );
  const one = cache.load('a', fetcher);
  const two = cache.load('a', fetcher);
  await Promise.resolve();
  expect(fetcher).toHaveBeenCalledTimes(1);
  cache.clear();
  const rejected = Promise.allSettled([one, two]);
  finish('private');
  expect((await rejected).map(r => r.status)).toEqual(['rejected', 'rejected']);
  expect(cache.get('a')).toBeUndefined();
});

test('cache bounds memory, expires entries and evicts least recently used data', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(0);
  const cache = createMailCache<string>(2, 100, 1000);
  await cache.load('a', async () => 'A');
  await cache.load('b', async () => 'B');
  cache.get('a');
  await cache.load('c', async () => 'C');
  expect(cache.get('b')).toBeUndefined();
  await cache.load('huge', async () => 'x'.repeat(101));
  expect(cache.get('huge')).toBeUndefined();
  jest.spyOn(Date, 'now').mockReturnValue(1000);
  expect(cache.get('a')).toBeUndefined();
});

test('opening then decrypting reuses the source; accounts and identities stay isolated', async () => {
  const fetch = jest
    .spyOn(imap, 'fetchMessageDetail')
    .mockResolvedValue({uid: 1} as any);
  await loadMailMessage('alice', context, 1, 'INBOX');
  await loadMailMessage('alice', context, 1, 'INBOX');
  expect(fetch).toHaveBeenCalledTimes(1);
  await loadMailMessage('bob', context, 1, 'INBOX');
  await loadMailMessage(
    'alice',
    {...context, account: {...context.account, id: 'other'}},
    1,
    'INBOX',
  );
  await loadMailMessage('alice', context, 1, 'Sent');
  expect(fetch).toHaveBeenCalledTimes(4);
  clearMailDataCache();
  await loadMailMessage('alice', context, 1, 'INBOX');
  expect(fetch).toHaveBeenCalledTimes(5);
});

test('cached pages remain available after a failed refresh', async () => {
  const result = {
    messages: [],
    folder: 'INBOX',
    page: 1,
    totalPages: 1,
    total: 0,
    found: true,
  };
  const fetch = jest
    .spyOn(imap, 'listMailboxMessages')
    .mockResolvedValueOnce(result)
    .mockRejectedValueOnce(new Error('offline'));
  const params = {folder: 'INBOX', page: 1, limit: 20};
  await refreshMailPage('alice', context, params);
  await expect(refreshMailPage('alice', context, params)).rejects.toThrow(
    'offline',
  );
  expect(getCachedMailPage('alice', context, params)).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
});
