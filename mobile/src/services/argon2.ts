import {argon2} from 'react-native-quick-crypto';
import {AES_SALT_LENGTH} from '../../../core/AES';

/** Same Argon2id v1.3 parameters as core/AES.ts and existing libsodium stores. */
export async function deriveIdentityKey(
  passwordBytes: Uint8Array,
  salt: Uint8Array,
): Promise<Uint8Array> {
  if (salt.length !== AES_SALT_LENGTH) {
    throw new Error(
      `Invalid salt length: expected ${AES_SALT_LENGTH}, got ${salt.length}`,
    );
  }
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      {
        message: passwordBytes,
        nonce: salt,
        parallelism: 1,
        tagLength: 32,
        memory: 64 * 1024, // Quick Crypto uses KiB, not libsodium's bytes.
        passes: 3,
        version: 0x13,
      },
      (error, key) => {
        if (error) {
          reject(error);
        } else if (!key || key.length !== 32) {
          reject(new Error('Argon2 returned an invalid key'));
        } else {
          resolve(new Uint8Array(key));
        }
      },
    );
  });
}
