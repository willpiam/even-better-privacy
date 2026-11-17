jest.mock('../src/services/storage', () => ({loadIdentityForUse: jest.fn()}));
jest.mock('../src/services/encryptDecrypt', () => ({
  decryptMessage: jest.fn(),
}));
jest.mock('../src/services/contacts', () => ({
  loadContact: jest.fn(async () => ({fingerprint: 'recipient'})),
}));
jest.mock('../src/services/settings', () => ({
  getMailIncludePublicKeys: async () => false,
}));
jest.mock('../src/services/mail/accountStore', () => ({
  resolveSelectedAccount: jest.fn(),
  getMailSecretsInMemory: jest.fn(),
}));
jest.mock('../src/services/mail/smtp', () => ({sendMimeMessage: jest.fn()}));
jest.mock('../src/services/mail/imap', () => ({appendSentCopy: jest.fn()}));
jest.mock('../src/services/mail/mailData', () => ({}));
import {sendEbpMail} from '../src/services/mail/ebpMail';
import {
  resolveSelectedAccount,
  getMailSecretsInMemory,
} from '../src/services/mail/accountStore';
import {sendMimeMessage} from '../src/services/mail/smtp';
import {appendSentCopy} from '../src/services/mail/imap';
import {loadIdentityForUse} from '../src/services/storage';
const context = {
  account: {
    id: 'original',
    config: {
      fromEmail: 'alice@example.com',
      fromName: 'Alice',
      username: 'alice',
    },
  },
  secrets: {imapPassword: 'imap', smtpPassword: 'smtp'},
};
const params = {
  identityName: 'Alice',
  accountId: 'original',
  subject: 'Hi',
  message: 'Secret',
  recipients: [{email: 'bob@example.com', contact: 'Bob'}],
  encrypt: jest.fn(async () => ({
    armor: '-----BEGIN EBP-----\nPAYLOAD\n-----END EBP-----',
    fingerprint: 'sender',
    shortFingerprint: 'sender',
  })),
};
beforeEach(() => {
  jest.clearAllMocks();
  (resolveSelectedAccount as jest.Mock).mockResolvedValue(context);
  (getMailSecretsInMemory as jest.Mock).mockReturnValue(context.secrets);
  (sendMimeMessage as jest.Mock).mockResolvedValue(undefined);
  (appendSentCopy as jest.Mock).mockResolvedValue('Sent');
});
test('reports encryption, delivery and saving in order and uses isolated encryption', async () => {
  const stages: string[] = [];
  const result = await sendEbpMail({
    ...params,
    onProgress: stage => stages.push(stage),
  });
  expect(stages).toEqual(['encrypting', 'sending', 'saving']);
  expect(result.savedToSent).toBe(true);
  expect(loadIdentityForUse).not.toHaveBeenCalled();
  expect(params.encrypt).toHaveBeenCalledWith(
    expect.objectContaining({includePublicKeys: false}),
  );
  expect(resolveSelectedAccount).toHaveBeenCalledWith('Alice', 'original');
  expect(
    (sendMimeMessage as jest.Mock).mock.invocationCallOrder[0],
  ).toBeLessThan((appendSentCopy as jest.Mock).mock.invocationCallOrder[0]);
});
test('failed Sent copy can be retried without resending SMTP and with the same MIME', async () => {
  (appendSentCopy as jest.Mock).mockRejectedValueOnce(new Error('Offline'));
  const result = await sendEbpMail(params);
  expect(result.savedToSent).toBe(false);
  await result.retrySentCopy!();
  expect(sendMimeMessage).toHaveBeenCalledTimes(1);
  expect(appendSentCopy).toHaveBeenCalledTimes(2);
  expect((appendSentCopy as jest.Mock).mock.calls[0][2]).toBe(
    (appendSentCopy as jest.Mock).mock.calls[1][2],
  );
  expect(getMailSecretsInMemory).toHaveBeenCalledWith('Alice', 'original');
});
test('SMTP failure never attempts a Sent save', async () => {
  (sendMimeMessage as jest.Mock).mockRejectedValueOnce(
    new Error('SMTP failed'),
  );
  await expect(sendEbpMail(params)).rejects.toThrow('SMTP failed');
  expect(appendSentCopy).not.toHaveBeenCalled();
});
