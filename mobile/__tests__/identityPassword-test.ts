import {AES, DecryptionAuthError, StorageFormatError} from '../../core/AES';
import {withIdentityPassword} from '../src/services/identityPassword';
import {sha256} from '@noble/hashes/sha2.js';
import {Buffer} from 'buffer';

describe('identity password compatibility', () => {
  it('preserves exact password bytes and supports older trimmed-password files', async () => {
    const password = ' Space-Sensitive-42! ';
    const salt = new Uint8Array(16).fill(5);
    // A fast KDF keeps this focused on exact password bytes and fallback rules.
    const keyFor = (candidate: string) =>
      sha256(Buffer.from(candidate, 'utf8'));
    const encrypted = AES.encryptWithKey(keyFor(password), 'identity', salt);
    const decrypt = async (candidate: string) =>
      AES.decryptWithKey(keyFor(candidate), encrypted);
    const result = await withIdentityPassword(password, decrypt);
    expect(result).toEqual({value: 'identity', password});
    const legacy = AES.encryptWithKey(
      keyFor(password.trim()),
      'legacy identity',
      salt,
    );
    const fallback = await withIdentityPassword(password, async candidate =>
      AES.decryptWithKey(keyFor(candidate), legacy),
    );
    expect(fallback).toEqual({
      value: 'legacy identity',
      password: password.trim(),
    });
  });

  it('retries only authentication failures and rejects wrong or empty passwords', async () => {
    const malformed = jest.fn(async () => {
      throw new StorageFormatError('bad data');
    });
    await expect(withIdentityPassword(' password ', malformed)).rejects.toThrow(
      'bad data',
    );
    expect(malformed).toHaveBeenCalledTimes(1);
    await expect(
      withIdentityPassword(' password ', async () => {
        throw new DecryptionAuthError();
      }),
    ).rejects.toBeInstanceOf(DecryptionAuthError);
    await expect(
      withIdentityPassword('', async () => 'unused'),
    ).rejects.toThrow('Password is required');
  });
});
