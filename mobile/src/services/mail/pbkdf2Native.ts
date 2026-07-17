import {pbkdf2} from 'react-native-quick-crypto';

/** PBKDF2 params matching GUI `mail-account.ts` (PBKDF2-HMAC-SHA-256, 210k). */
export const MAIL_SECRETS_KDF_ITERATIONS = 210_000;

/** Offline vector: password "ebp-mail-parity-v1", salt bytes 0..15, 210k iterations. */
export const MAIL_PBKDF2_PARITY_PASSWORD = 'ebp-mail-parity-v1';
export const MAIL_PBKDF2_PARITY_SALT = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);
export const MAIL_PBKDF2_PARITY_EXPECTED_HEX =
  '7ed3d04bc73db4fd0c08cb0d4372416e84de43a7684ac821c142609d87aeb3be';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, dkLen, 'sha256', (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      if (!derivedKey) {
        reject(new Error('PBKDF2 returned no key'));
        return;
      }
      resolve(new Uint8Array(derivedKey));
    });
  });
}

/**
 * Derive a 32-byte AES key for mail secrets (GUI-compatible PBKDF2-HMAC-SHA-256).
 * Uses native OpenSSL via react-native-quick-crypto; pure JS noble is too slow on Hermes.
 */
export async function deriveMailSecretsKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  return pbkdf2Sha256(
    new TextEncoder().encode(pin),
    salt,
    iterations,
    32,
  );
}

/** On-device check: native PBKDF2 must match the offline noble/OpenSSL vector. */
export async function verifyMailPbkdf2Parity(): Promise<{
  ok: boolean;
  expected: string;
  actual: string;
}> {
  const key = await pbkdf2Sha256(
    new TextEncoder().encode(MAIL_PBKDF2_PARITY_PASSWORD),
    MAIL_PBKDF2_PARITY_SALT,
    MAIL_SECRETS_KDF_ITERATIONS,
    32,
  );
  const actual = bytesToHex(key);
  return {
    ok: actual === MAIL_PBKDF2_PARITY_EXPECTED_HEX,
    expected: MAIL_PBKDF2_PARITY_EXPECTED_HEX,
    actual,
  };
}
