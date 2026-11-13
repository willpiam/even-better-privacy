import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { argon2id } from "@noble/hashes/argon2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const AES_SALT_LENGTH = 16; // 128-bit salt
const SALT_LENGTH = AES_SALT_LENGTH;
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const KEY_LENGTH = 32; // 256 bits

// Only AES v4 is supported: Argon2id and AES-GCM metadata binding.
const CURRENT_AES_VERSION = FILE_FORMAT_VERSIONS.aesCiphertext; // 4

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

function requireCurrentVersion(version: number): void {
  if (version !== CURRENT_AES_VERSION) {
    throw new StorageFormatError(
      `Unsupported ciphertext version: ${version}; only v${CURRENT_AES_VERSION} is supported`,
    );
  }
}

function encodeAad(aad?: string): Uint8Array | undefined {
  return aad === undefined ? undefined : encoder.encode(aad);
}

function parseCiphertextBytes(encoded: string): Uint8Array {
  try {
    const data = base64ToBytes(encoded);
    if (data.length < 1 + SALT_LENGTH + IV_LENGTH) {
      throw new StorageFormatError("Invalid ciphertext");
    }
    requireCurrentVersion(data[0]);
    return data;
  } catch (e) {
    if (e instanceof StorageFormatError) throw e;
    throw new StorageFormatError("Invalid ciphertext encoding");
  }
}

export class AES {
  static encrypt(password: string, plaintext: string, aad?: string): string {
    const salt = randomBytes(SALT_LENGTH);
    const key = deriveKey(password, salt);
    return AES.encryptWithKey(key, plaintext, salt, aad);
  }

  static encryptWithKey(
    key: Uint8Array,
    plaintext: string,
    salt: Uint8Array,
    aad?: string,
  ): string {
    if (salt.length !== SALT_LENGTH) {
      throw new StorageFormatError("Invalid salt length");
    }
    const iv = randomBytes(IV_LENGTH);
    const data = encoder.encode(plaintext);
    const cipher = gcm(key, iv, encodeAad(aad));
    const ciphertext = cipher.encrypt(data);

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
    const { salt } = AES.readHeader(encoded);
    const key = deriveKey(password, salt);
    return AES.decryptWithKey(key, encoded, aad);
  }

  static decryptWithKey(
    key: Uint8Array,
    encoded: string,
    aad?: string,
  ): string {
    const data = parseCiphertextBytes(encoded);

    const saltStart = 1;
    const saltEnd = saltStart + SALT_LENGTH;
    const ivEnd = saltEnd + IV_LENGTH;

    const iv = data.slice(saltEnd, ivEnd);
    const ciphertext = data.slice(ivEnd);

    const decipher = gcm(
      key,
      iv,
      encodeAad(aad),
    );
    let plaintextBytes: Uint8Array;
    try {
      plaintextBytes = decipher.decrypt(ciphertext);
    } catch {
      throw new DecryptionAuthError();
    }

    return decoder.decode(plaintextBytes);
  }

  static readHeader(encoded: string): { version: number; salt: Uint8Array } {
    const data = parseCiphertextBytes(encoded);
    const version = data[0];
    const salt = data.slice(1, 1 + SALT_LENGTH);
    return { version, salt };
  }

  static getCiphertextVersion(encoded: string): number {
    return AES.readHeader(encoded).version;
  }

  /** Derive a 32-byte AES key (noble). Used by tests and desktop paths. */
  static deriveKeyForStorage(
    password: string,
    salt: Uint8Array,
    version: number,
  ): Uint8Array {
    requireCurrentVersion(version);
    return deriveKey(password, salt);
  }
}

function deriveKey(
  password: string,
  salt: Uint8Array,
): Uint8Array {
  const passwordBytes = encoder.encode(password);

  return argon2id(passwordBytes, salt, {
    t: ARGON2_ITERATIONS,
    m: ARGON2_MEMORY_KIB,
    p: ARGON2_PARALLELISM,
    dkLen: KEY_LENGTH,
  });
}
