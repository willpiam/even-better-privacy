/** Imported only by development screens, keeping vectors and self-tests out of releases. */
import {Identity, shortFingerprint, toHex} from '../ebpCore';
import {Buffer} from 'buffer';
import {deriveIdentityKey} from './argon2';
import {
  deriveMailSecretsKey,
  MAIL_SECRETS_KDF_ITERATIONS,
} from './mail/pbkdf2Native';

const PARITY_SALT = new Uint8Array([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
]);

export async function verifyArgon2NobleParity() {
  const expected =
    '5703afdf8212782802be86122b5e07a53b593ef859719f91e6d0451ee80cc54a';
  const key = await deriveIdentityKey(
    new Uint8Array(Buffer.from('ebp-mobile-parity-v1', 'utf8')),
    PARITY_SALT,
  );
  const actual = toHex(key);
  return {ok: actual === expected, expected, actual};
}

export async function verifyMailPbkdf2Parity() {
  const expected =
    '7ed3d04bc73db4fd0c08cb0d4372416e84de43a7684ac821c142609d87aeb3be';
  const key = await deriveMailSecretsKey(
    'ebp-mail-parity-v1',
    PARITY_SALT,
    MAIL_SECRETS_KDF_ITERATIONS,
  );
  const actual = toHex(key);
  return {ok: actual === expected, expected, actual};
}

export async function runCoreSelfTest(): Promise<string> {
  const identity = new Identity('dilithium', 'kyber');
  const fingerprint = identity.toFingerprint();
  const signature = identity.signMessage('mobile-self-test');
  if (!fingerprint || !identity.verifyMessage('mobile-self-test', signature)) {
    throw new Error('Core self-test failed');
  }
  return `Core OK (${shortFingerprint(fingerprint)})`;
}
