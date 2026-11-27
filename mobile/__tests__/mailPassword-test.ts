jest.mock('../src/services/atomicFile', () => ({writeFileAtomic: (path: string, content: string) => require('react-native-fs').writeFile(path, content, 'utf8')}));
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
  bytesToBase64: (bytes: Uint8Array) =>
    require('buffer').Buffer.from(bytes).toString('base64'),
  base64ToBytes: (text: string) =>
    new Uint8Array(require('buffer').Buffer.from(text, 'base64')),
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
  decryptSecretsStore,
  deleteMailAccount,
  encryptSecretsStore,
  getMailPinInMemory,
  getMailSecretsInMemory,
  readMailStore,
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
    record: {
      id: 'account',
      name: 'Mail',
      config: {
        ...DEFAULT_MAIL_ACCOUNT,
        authType: 'password',
        persistSecrets: true,
      },
    },
    imapPassword: 'imap-secret',
    smtpPassword: 'smtp-secret',
  });
  clearMailSecretsMemory('me');
  expect(getMailPinInMemory('me')).toBeNull();
  expect(await unlockMailWithIdentityPassword('me', 'identity-password')).toBe(
    true,
  );
  expect(getMailSecretsInMemory('me', 'account')?.imapPassword).toBe(
    'imap-secret',
  );
});

test('obsolete PIN and plaintext credential stores cannot be unlocked or rewritten', async () => {
  const secrets = {account: {imapPassword: 'imap', smtpPassword: 'smtp'}};
  for (const original of [
    await encryptSecretsStore('old-pin', secrets),
    JSON.stringify(secrets),
  ]) {
    await RNFS.writeFile('/mail/secrets', original, 'utf8');
    expect(
      await unlockMailWithIdentityPassword('me', 'identity-password'),
    ).toBe(false);
    expect(await RNFS.readFile('/mail/secrets', 'utf8')).toBe(original);
    expect(getMailSecretsInMemory('me', 'account')).toBeNull();
    clearMailSecretsMemory();
  }
});

test('concurrent account updates and selection preserve all acknowledged records', async () => {
  const {upsertMailAccount,readMailStore,selectMailAccount,deleteMailAccount} = require('../src/services/mail/accountStore');
  const saved=await Promise.all(Array.from({length:20},(_,index) => upsertMailAccount('alice',{id:`parallel-${index}`,name:`Parallel ${index}`,config:DEFAULT_MAIL_ACCOUNT})));
  expect(saved).toHaveLength(20);
  await Promise.all([selectMailAccount('alice','parallel-5'),deleteMailAccount('alice','parallel-0'),upsertMailAccount('alice',{id:'parallel-last',name:'Last',config:DEFAULT_MAIL_ACCOUNT})]);
  const store=await readMailStore('alice');
  for(let index=1;index<20;index++)expect(store.accounts.some((a:{id:string}) => a.id===`parallel-${index}`)).toBe(true);
  expect(store.accounts.some((a:{id:string})=>a.id==='parallel-last')).toBe(true);
  expect(store.accounts.some((a:{id:string})=>a.id==='parallel-0')).toBe(false);
});

test('removing a saved account preserves the other vault entries', async () => {
  const password = 'identity-password';
  await unlockMailWithIdentityPassword('me', password);
  for (const id of ['first', 'second']) {
    await saveMailAccountWithSecrets('me', {
      record: {id, name: id, config: {...DEFAULT_MAIL_ACCOUNT, persistSecrets: true}},
      imapPassword: id,
      smtpPassword: id,
    });
  }
  clearMailSecretsMemory('me');
  await expect(deleteMailAccount('me', 'first')).rejects.toThrow('Mail secrets locked');
  expect((await readMailStore('me')).accounts).toHaveLength(2);

  await unlockMailWithIdentityPassword('me', password);
  await deleteMailAccount('me', 'first');
  const vault = await RNFS.readFile('/mail/secrets', 'utf8');
  expect(await decryptSecretsStore(password, vault)).toEqual({
    second: {imapPassword: 'second', smtpPassword: 'second'},
  });
  expect(getMailSecretsInMemory('me', 'first')).toBeNull();

  clearMailSecretsMemory('me');
  await deleteMailAccount('me', 'second');
  expect(await RNFS.exists('/mail/secrets')).toBe(false);
  expect((await readMailStore('me')).accounts).toEqual([]);
});

test('unlock purges orphaned passwords left by older removals', async () => {
  const password = 'identity-password';
  await RNFS.writeFile('/mail/accounts', JSON.stringify({accounts: []}), 'utf8');
  await RNFS.writeFile('/mail/secrets', await encryptSecretsStore(password, {
    removed: {imapPassword: 'old-imap', smtpPassword: 'old-smtp'},
  }), 'utf8');
  expect(await unlockMailWithIdentityPassword('me', password)).toBe(true);
  expect(getMailSecretsInMemory('me', 'removed')).toBeNull();
  expect(await RNFS.exists('/mail/secrets')).toBe(false);
});
