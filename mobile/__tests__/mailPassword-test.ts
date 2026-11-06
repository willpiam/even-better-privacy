jest.mock('react-native-fs', () => {
  const files = new Map<string, string>();
  return {
    exists: jest.fn(async (path: string) => files.has(path)),
    readFile: jest.fn(async (path: string) => files.get(path)),
    writeFile: jest.fn(async (path: string, data: string) => {
      files.set(path, data);
    }),
    unlink: jest.fn(async (path: string) => {
      files.delete(path);
    }),
  };
});
jest.mock('../src/services/mail/paths', () => ({
  ensureIdentityMailDir: jest.fn(async () => '/mail'),
  mailAccountPath: () => '/mail/accounts',
  mailSecretsPath: () => '/mail/secrets',
}));
jest.mock('../src/services/unlockSession', () => ({
  onIdentityLocked: jest.fn(),
}));
jest.mock('../src/ebpCore', () => ({
  randomBytes: (size: number) =>
    new Uint8Array(require('crypto').randomBytes(size)),
  bytesToBase64: (bytes: Uint8Array) => require('buffer').Buffer.from(bytes).toString('base64'),
  base64ToBytes: (text: string) => new Uint8Array(require('buffer').Buffer.from(text, 'base64')),
}));
jest.mock('../src/services/mail/pbkdf2Native', () => ({
  MAIL_SECRETS_KDF_ITERATIONS: 1000,
  deriveMailSecretsKey: async (
    password: string,
    salt: Uint8Array,
    iterations: number,
  ) =>
    new Uint8Array(
      require('crypto').pbkdf2Sync(password, salt, iterations, 32, 'sha256'),
    ),
}));
import RNFS from 'react-native-fs';
import {DEFAULT_MAIL_ACCOUNT} from '../src/services/mail/types';
import {
  clearMailSecretsMemory,
  encryptSecretsStore,
  getMailPinInMemory,
  getMailSecretsInMemory,
  migrateMailSecrets,
  saveMailAccountWithSecrets,
  unlockMailWithIdentityPassword,
} from '../src/services/mail/accountStore';

beforeAll(() => {
  const {TextEncoder, TextDecoder} = require('util');
  Object.assign(globalThis, {TextEncoder, TextDecoder});
});
beforeEach(async () => {
  clearMailSecretsMemory();
  await RNFS.unlink('/mail/secrets');
  await RNFS.unlink('/mail/accounts');
});

test('new stores reuse the verified identity password and locking clears it', async () => {
  expect(await unlockMailWithIdentityPassword('me', 'identity-password')).toBe(
    true,
  );
  expect(getMailPinInMemory('me')).toBe('identity-password');
  await saveMailAccountWithSecrets('me', {
    record: {id: 'account', name: 'Mail', config: {...DEFAULT_MAIL_ACCOUNT, authType: 'password', persistSecrets: true}},
    imapPassword: 'imap-secret', smtpPassword: 'smtp-secret', pin: 'ignored-pin',
  });
  clearMailSecretsMemory('me');
  expect(getMailPinInMemory('me')).toBeNull();
  expect(await unlockMailWithIdentityPassword('me', 'identity-password')).toBe(true);
  expect(getMailSecretsInMemory('me', 'account')?.imapPassword).toBe('imap-secret');
});

test('legacy PIN migration preserves credentials and subsequently uses the identity password', async () => {
  const secrets = {account: {imapPassword: 'imap', smtpPassword: 'smtp'}};
  await RNFS.writeFile(
    '/mail/secrets',
    await encryptSecretsStore('old-pin', secrets),
    'utf8',
  );
  expect(await unlockMailWithIdentityPassword('me', 'identity-password')).toBe(
    false,
  );
  const original = await RNFS.readFile('/mail/secrets', 'utf8');
  await expect(migrateMailSecrets('me', 'wrong-pin')).rejects.toThrow();
  expect(await RNFS.readFile('/mail/secrets', 'utf8')).toBe(original);
  await migrateMailSecrets('me', 'old-pin');
  clearMailSecretsMemory('me');
  expect(await unlockMailWithIdentityPassword('me', 'identity-password')).toBe(
    true,
  );
  expect(getMailSecretsInMemory('me', 'account')).toEqual(secrets.account);
});

test('migration requires a verified identity password', async () => {
  await expect(migrateMailSecrets('me', 'old-pin')).rejects.toThrow(
    'Unlock your identity',
  );
});
