import {moveMailboxMessage} from '../src/services/mail/imap';
import {
  connectMailLineClient,
  readTaggedOk,
} from '../src/services/mail/tcpClient';
import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';

jest.mock('../src/services/mail/tcpClient', () => ({
  connectMailLineClient: jest.fn(),
  readTaggedOk: jest.fn(),
}));
jest.mock('../src/services/mail/mailTrace', () => ({mailStub: jest.fn()}));
const client = {readLine: jest.fn(), writeLine: jest.fn(), close: jest.fn()};
const secrets = {imapPassword: 'secret', smtpPassword: 'secret'};
beforeEach(() => {
  jest.clearAllMocks();
  client.readLine.mockResolvedValue('* OK ready');
  jest.mocked(connectMailLineClient).mockResolvedValue(client as never);
  jest.mocked(readTaggedOk).mockImplementation(async (_, tag) => {
    if (tag === 'm1')
      return [
        '* LIST (\\Trash) "/" "Deleted Items"',
        '* LIST (\\All) "/" "[Gmail]/All Mail"',
      ];
    if (tag === 'm2') return ['* CAPABILITY IMAP4rev1 MOVE'];
    if (tag === 'm3') return ['* OK [UIDVALIDITY 7] UIDs valid'];
    return [];
  });
});
it.each([
  ['delete', '"Deleted Items"'],
  ['archive', '"[Gmail]/All Mail"'],
] as const)(
  'moves the selected UID to the provider %s folder',
  async (action, target) => {
    await moveMailboxMessage(
      DEFAULT_MAIL_ACCOUNT,
      secrets,
      42,
      'INBOX',
      action,
      7,
    );
    expect(client.writeLine).toHaveBeenCalledWith(`m4 UID MOVE 42 ${target}`);
    expect(client.close).toHaveBeenCalled();
  },
);
it('does not use broad EXPUNGE on a server without MOVE', async () => {
  jest
    .mocked(readTaggedOk)
    .mockImplementation(async (_, tag) =>
      tag === 'm1' ? ['* LIST (\\Trash) "/" Trash'] : [],
    );
  await expect(
    moveMailboxMessage(DEFAULT_MAIL_ACCOUNT, secrets, 42, 'INBOX', 'delete', 7),
  ).rejects.toThrow('safe message moves');
  expect(
    client.writeLine.mock.calls.some(([line]) => /EXPUNGE|UID MOVE/.test(line)),
  ).toBe(false);
  expect(client.close).toHaveBeenCalled();
});
it('rejects invalid UIDs before opening a connection', async () => {
  await expect(
    moveMailboxMessage(DEFAULT_MAIL_ACCOUNT, secrets, 0, 'INBOX', 'delete', 7),
  ).rejects.toThrow('Invalid message UID');
  expect(connectMailLineClient).not.toHaveBeenCalled();
});

it('requires a fresh message list when the mailbox generation changed', async () => {
  await expect(
    moveMailboxMessage(DEFAULT_MAIL_ACCOUNT, secrets, 42, 'INBOX', 'delete', 6),
  ).rejects.toThrow('This mailbox changed');
  expect(client.writeLine.mock.calls.some(([line]) => /UID MOVE/.test(line))).toBe(false);
  expect(client.close).toHaveBeenCalled();
});

it('requires a known mailbox generation before connecting to move a message', async () => {
  await expect(
    moveMailboxMessage(DEFAULT_MAIL_ACCOUNT, secrets, 42, 'INBOX', 'delete', undefined),
  ).rejects.toThrow('Refresh the message list');
  expect(connectMailLineClient).not.toHaveBeenCalled();
});
