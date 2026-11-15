import {pbkdf2} from 'react-native-quick-crypto';

/** PBKDF2 params matching GUI `mail-account.ts` (PBKDF2-HMAC-SHA-256, 210k). */
export const MAIL_SECRETS_KDF_ITERATIONS = 210_000;

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
  return pbkdf2Sha256(new TextEncoder().encode(pin), salt, iterations, 32);
}
