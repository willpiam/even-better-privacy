import sodium from 'react-native-libsodium';
import {ensureNativeCryptoReady} from './cryptoInit';

/** Argon2id params matching @noble/hashes in core/AES.ts (m=64MiB KiB, t=3, p=1). */
const OPSLIMIT = 3;
const MEMLIMIT_BYTES = 64 * 1024 * 1024;
const KEY_LENGTH = 32;

/** Offline noble vector: password "ebp-mobile-parity-v1", salt bytes 0..15. */
export const ARGON2_PARITY_PASSWORD = 'ebp-mobile-parity-v1';
export const ARGON2_PARITY_SALT = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);
export const ARGON2_PARITY_EXPECTED_HEX =
  '5703afdf8212782802be86122b5e07a53b593ef859719f91e6d0451ee80cc54a';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Derive a 32-byte AES key via native libsodium Argon2id (ARGON2ID13, p=1).
 * Byte output must match noble for EBP identity interop.
 */
export async function deriveIdentityKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (salt.length !== sodium.crypto_pwhash_SALTBYTES) {
    throw new Error(
      `Invalid salt length: expected ${sodium.crypto_pwhash_SALTBYTES}, got ${salt.length}`,
    );
  }
  await ensureNativeCryptoReady();
  return sodium.crypto_pwhash(
    KEY_LENGTH,
    passwordBytes,
    salt,
    OPSLIMIT,
    MEMLIMIT_BYTES,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

/**
 * Dev/on-device check: native libsodium output must match offline noble vector.
 * Run once after a native rebuild before trusting mobile identity unlock.
 */
export async function verifyArgon2NobleParity(): Promise<{
  ok: boolean;
  expected: string;
  actual: string;
}> {
  const passwordBytes = new TextEncoder().encode(ARGON2_PARITY_PASSWORD);
  const key = await deriveIdentityKey(passwordBytes, ARGON2_PARITY_SALT);
  const actual = bytesToHex(key);
  return {
    ok: actual === ARGON2_PARITY_EXPECTED_HEX,
    expected: ARGON2_PARITY_EXPECTED_HEX,
    actual,
  };
}
