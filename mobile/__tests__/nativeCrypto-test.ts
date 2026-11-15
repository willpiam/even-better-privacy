import {Buffer} from 'buffer';
import type {Buffer as NativeBuffer} from '@craftzdog/react-native-buffer';
import {Identity} from '../../core/Identity';
import {deriveIdentityKey} from '../src/services/argon2';
import {
  verifyArgon2NobleParity,
  verifyMailPbkdf2Parity,
} from '../src/services/developerChecks';
import {argon2} from 'react-native-quick-crypto';

jest.setTimeout(120_000);

// Exercise the production adapter against independent OpenSSL (Node 24+) or noble.
// On-device Diagnostics additionally checks the actual Nitro/OpenSSL binary.
jest.mock('react-native-quick-crypto', () => ({
  argon2: jest.fn((algorithm, params, callback) => {
    if (algorithm !== 'argon2id' || params.version !== 0x13) {
      throw new Error('Unexpected Argon2 algorithm or version');
    }
    const crypto = require('crypto');
    if (crypto.argon2) {
      crypto.argon2(algorithm, params, callback);
      return;
    }
    const {argon2id} = require('@noble/hashes/argon2.js');
    try {
      const key = argon2id(params.message, params.nonce, {
        m: params.memory,
        t: params.passes,
        p: params.parallelism,
        dkLen: params.tagLength,
      });
      callback(null, require('buffer').Buffer.from(key));
    } catch (error) {
      callback(error);
    }
  }),
  pbkdf2: (...args: unknown[]) => require('crypto').pbkdf2(...args),
}));

beforeAll(() => {
  const {TextEncoder, TextDecoder} = require('util');
  Object.assign(globalThis, {TextEncoder, TextDecoder});
});

it('retains the existing libsodium/noble Argon2id and mail PBKDF2 vectors', async () => {
  expect((await verifyArgon2NobleParity()).ok).toBe(true);
  expect((await verifyMailPbkdf2Parity()).ok).toBe(true);
});

it('unlocks and rewrites a store encrypted with the existing libsodium vector', async () => {
  const identity = new Identity('dilithium', 'kyber');
  const password = 'ebp-mobile-parity-v1';
  const salt = new Uint8Array(Array.from({length: 16}, (_, i) => i));
  const originalKey = new Uint8Array(
    Buffer.from(
      '5703afdf8212782802be86122b5e07a53b593ef859719f91e6d0451ee80cc54a',
      'hex',
    ),
  );
  const existing = identity.toStorageFormatWithKey(originalKey, salt);
  const key = await deriveIdentityKey(
    new Uint8Array(Buffer.from(password)),
    salt,
  );
  const unlocked = Identity.fromStorageFormatWithKey(existing, key);
  expect(unlocked.toFingerprint()).toBe(identity.toFingerprint());
  const rewritten = unlocked.toStorageFormatWithKey(key, salt);
  expect(
    Identity.fromStorageFormatWithKey(rewritten, originalKey).toFingerprint(),
  ).toBe(identity.toFingerprint());
});

it('preserves exact whitespace and Unicode password bytes', async () => {
  const password = new Uint8Array(Buffer.from('  Caffè-🔑-e\u0301  '));
  const salt = new Uint8Array(Array.from({length: 16}, (_, i) => i));
  const key = await deriveIdentityKey(password, salt);
  // Independent OpenSSL vector for the untrimmed, non-normalized UTF-8 bytes.
  expect(Buffer.from(key).toString('hex')).toBe(
    '86986052f5a341b577144951692f5372c5449068dc9ee44f150a7185e056021c',
  );
});

it('rejects invalid salts before calling native crypto', async () => {
  const native = jest.mocked(argon2);
  native.mockClear();
  for (const length of [0, 8, 15, 17]) {
    await expect(
      deriveIdentityKey(new Uint8Array([1]), new Uint8Array(length)),
    ).rejects.toThrow('Invalid salt length');
  }
  expect(native).not.toHaveBeenCalled();
});

it('propagates native failures and refuses malformed key output', async () => {
  const native = jest.mocked(argon2);
  native.mockImplementationOnce((_algorithm, _params, callback) => {
    callback(
      new Error('Native KDF unavailable'),
      Buffer.alloc(0) as unknown as NativeBuffer,
    );
  });
  await expect(
    deriveIdentityKey(new Uint8Array([1]), new Uint8Array(16)),
  ).rejects.toThrow('Native KDF unavailable');
  native.mockImplementationOnce((_algorithm, _params, callback) => {
    callback(null, Buffer.alloc(31) as unknown as NativeBuffer);
  });
  await expect(
    deriveIdentityKey(new Uint8Array([1]), new Uint8Array(16)),
  ).rejects.toThrow('Argon2 returned an invalid key');
});
