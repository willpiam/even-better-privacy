import {sha256} from '@noble/hashes/sha2.js';
import {Buffer} from 'buffer';
import {Identity} from '../../core/Identity';
import {
  persistIdentity,
  loadIdentity,
  unlockIdentity,
  mutateIdentityForUse,
  loadIdentityUnlocked,
} from '../src/services/storage';
import {unlockMailWithIdentityPassword} from '../src/services/mail/accountStore';

const mockFiles = new Map<string, string>();
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/documents',
  exists: jest.fn(async () => true),
  mkdir: jest.fn(async () => {}),
  readFile: jest.fn(async (path: string) => mockFiles.get(path)),
  writeFile: jest.fn(async (path: string, content: string) => {
    mockFiles.set(path, content);
  }),
}));
jest.mock('../src/services/argon2', () => ({
  deriveIdentityKey: jest.fn(async (bytes: Uint8Array) =>
    require('@noble/hashes/sha2.js').sha256(bytes),
  ),
}));
jest.mock('../src/services/unlockSession', () => {
  const materials = new Map();
  return {
    cacheUnlockedIdentity: jest.fn(
      async (name: string, key: Uint8Array, salt: Uint8Array) =>
        materials.set(name, {key: key.slice(), salt: salt.slice()}),
    ),
    getUnlockMaterial: (name: string) => materials.get(name),
    lock: (name: string) => materials.delete(name),
  };
});
jest.mock('../src/services/mail/accountStore', () => ({
  unlockMailWithIdentityPassword: jest.fn(async () => true),
}));

describe('mobile identity storage passwords and mutations', () => {
  it('creates, loads, and unlocks with exact password bytes', async () => {
    const identity = new Identity('dilithium', 'kyber');
    const password = ' Exact-Password-42! ';
    await persistIdentity({name: 'exact', password, identity, overwrite: true});
    const raw = mockFiles.get('/documents/ebp/exact.identity.json')!;
    const key = sha256(Buffer.from(password, 'utf8'));
    expect(Identity.fromStorageFormatWithKey(raw, key).toFingerprint()).toBe(
      identity.toFingerprint(),
    );
    expect((await loadIdentity('exact', password)).toFingerprint()).toBe(
      identity.toFingerprint(),
    );
    await unlockIdentity('exact', password);
    expect(unlockMailWithIdentityPassword).toHaveBeenLastCalledWith(
      'exact',
      password,
    );
  });

  it('unlocks older trimmed-password files and preserves compatibility after updates', async () => {
    const identity = new Identity('dilithium', 'kyber');
    const password = ' Legacy-Password-42! ';
    const key = sha256(Buffer.from(password.trim(), 'utf8'));
    mockFiles.set(
      '/documents/ebp/legacy.identity.json',
      identity.toStorageFormatWithKey(key, new Uint8Array(16)),
    );
    await unlockIdentity('legacy', password);
    expect(unlockMailWithIdentityPassword).toHaveBeenLastCalledWith(
      'legacy',
      password.trim(),
    );
    await mutateIdentityForUse('legacy', password, current =>
      current.attachDetail('email', 'legacy@example.test'),
    );
    expect((await loadIdentity('legacy', password)).getDetail('email')).toBe(
      'legacy@example.test',
    );
  });

  it('preserves concurrent updates and releases the queue after a failed mutation', async () => {
    const identity = new Identity('dilithium', 'kyber');
    const password = 'Concurrent-Password-42';
    await persistIdentity({
      name: 'concurrent',
      password,
      identity,
      overwrite: true,
    });
    await unlockIdentity('concurrent', password);
    await Promise.all(
      ['first', 'second'].map(path =>
        mutateIdentityForUse('concurrent', undefined, current =>
          current.attachDetail(path, path),
        ),
      ),
    );
    const loaded = await loadIdentityUnlocked('concurrent');
    expect([...loaded.details.keys()]).toEqual(['first', 'second']);
    expect(loaded.detailsNonce).toBe(2);
    await expect(
      mutateIdentityForUse('concurrent', undefined, () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await mutateIdentityForUse('concurrent', undefined, current =>
      current.attachDetail('third', 'three'),
    );
    expect((await loadIdentityUnlocked('concurrent')).details.size).toBe(3);
  });
});
