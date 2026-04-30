import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import { argon2id } from "@noble/hashes/argon2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SALT_LENGTH = 16; // 128-bit salt
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const KEY_LENGTH = 32; // 256 bits

// F-STORAGE-02/03: v1 used PBKDF2-310k, v2 raised to PBKDF2-600k, v3 moves
// to Argon2id (m=64MiB,t=3,p=1), and v4 adds optional AES-GCM AAD binding for
// storage-format metadata. The leading version byte keeps all historic
// ciphertexts decryptable while new writes use the stronger KDF/AAD support.
const PBKDF2_ITERATIONS_V1 = 310_000;
const PBKDF2_ITERATIONS_V2 = 600_000;
const CURRENT_AES_VERSION = FILE_FORMAT_VERSIONS.aesCiphertext; // 3

const ARGON2_MEMORY_KIB = 64 * 1024; // 64 MiB
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 1;

export class DecryptionAuthError extends Error {
  constructor(message = "Wrong password or tampered ciphertext") {
    super(message);
    this.name = "DecryptionAuthError";
  }
}

export class StorageFormatError extends Error {
  constructor(message = "Invalid storage format") {
    super(message);
    this.name = "StorageFormatError";
  }
}

function iterationsForVersion(version: number): number {
  if (version === 1) return PBKDF2_ITERATIONS_V1;
  if (version === 2) return PBKDF2_ITERATIONS_V2;
  if (version === 3) return PBKDF2_ITERATIONS_V2;
  if (version === 4) return PBKDF2_ITERATIONS_V2;
  throw new StorageFormatError(`Unsupported ciphertext version: ${version}`);
}

function encodeAad(aad?: string): Uint8Array | undefined {
  return aad === undefined ? undefined : encoder.encode(aad);
}

export class AES {
  static encrypt(password: string, plaintext: string, aad?: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = deriveKey(
      password,
      salt,
      iterationsForVersion(CURRENT_AES_VERSION),
      CURRENT_AES_VERSION,
    );

    const data = encoder.encode(plaintext);
    const cipher = gcm(key, iv, encodeAad(aad));
    const ciphertext = cipher.encrypt(data);

    // [version(1)] [salt] [iv] [ciphertext]
    const result = new Uint8Array(
      1 + salt.length + iv.length + ciphertext.length,
    );
    result[0] = CURRENT_AES_VERSION;
    result.set(salt, 1);
    result.set(iv, 1 + salt.length);
    result.set(ciphertext, 1 + salt.length + iv.length);

    return bytesToBase64(result);
  }

  static decrypt(password: string, encoded: string, aad?: string): string {
    let data: Uint8Array;
    try {
      data = base64ToBytes(encoded);
    } catch {
      throw new StorageFormatError("Invalid ciphertext encoding");
    }
    if (data.length < 1 + SALT_LENGTH + IV_LENGTH) {
      throw new StorageFormatError("Invalid ciphertext");
    }

    const version = data[0];
    const iterations = iterationsForVersion(version);

    const saltStart = 1;
    const saltEnd = saltStart + SALT_LENGTH;
    const ivEnd = saltEnd + IV_LENGTH;

    const salt = data.slice(saltStart, saltEnd);
    const iv = data.slice(saltEnd, ivEnd);
    const ciphertext = data.slice(ivEnd);

    const key = deriveKey(password, salt, iterations, version);

    const decipher = gcm(
      key,
      iv,
      version >= 4 ? encodeAad(aad) : undefined,
    );
    let plaintextBytes: Uint8Array;
    try {
      plaintextBytes = decipher.decrypt(ciphertext);
    } catch {
      throw new DecryptionAuthError();
    }

    return decoder.decode(plaintextBytes);
  }

  // F-STORAGE-02: utility so callers (identity-unlock flow) can detect a
  // legacy v1 blob and transparently rewrite it at v2 after a successful
  // decrypt.
  static getCiphertextVersion(encoded: string): number {
    const data = base64ToBytes(encoded);
    if (data.length < 1) throw new Error("Invalid ciphertext");
    return data[0];
  }

  static isLegacyCiphertext(encoded: string): boolean {
    try {
      return AES.getCiphertextVersion(encoded) < CURRENT_AES_VERSION;
    } catch {
      return false;
    }
  }
}

function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
  version: number,
): Uint8Array {
  const passwordBytes = encoder.encode(password);

  if (version >= 3) {
    return argon2id(passwordBytes, salt, {
      t: ARGON2_ITERATIONS,
      m: ARGON2_MEMORY_KIB,
      p: ARGON2_PARALLELISM,
      dkLen: KEY_LENGTH,
    });
  }

  return pbkdf2(sha256, passwordBytes, salt, {
    c: iterations,
    dkLen: KEY_LENGTH,
  });
}
