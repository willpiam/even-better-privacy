import { bytesToBase64, base64ToBytes } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SALT_LENGTH = 16; // 128-bit salt
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const KEY_LENGTH = 32; // 256 bits

// F-STORAGE-02: PBKDF2 iteration count was 310,000 (OWASP 2023 floor).
// v2 raises this to 600,000 (OWASP 2024+ floor for SHA-256). The version
// byte at the start of the ciphertext encodes which iteration count was
// used at encrypt time, so old blobs remain decryptable and new writes
// get the stronger parameter. A follow-up migration to Argon2id is
// tracked separately.
const PBKDF2_ITERATIONS_V1 = 310_000;
const PBKDF2_ITERATIONS_V2 = 600_000;
const CURRENT_AES_VERSION = FILE_FORMAT_VERSIONS.aesCiphertext; // 2

function iterationsForVersion(version: number): number {
	if (version === 1) return PBKDF2_ITERATIONS_V1;
	if (version === 2) return PBKDF2_ITERATIONS_V2;
	throw new Error(`Unsupported ciphertext version: ${version}`);
}

export class AES {
	static encrypt(password: string, plaintext: string): string {
		const salt = randomBytes(SALT_LENGTH);
		const iv = randomBytes(IV_LENGTH);
		const key = deriveKey(password, salt, iterationsForVersion(CURRENT_AES_VERSION));

		const data = encoder.encode(plaintext);
		const cipher = gcm(key, iv);
		const ciphertext = cipher.encrypt(data);

		// [version(1)] [salt] [iv] [ciphertext]
		const result = new Uint8Array(1 + salt.length + iv.length + ciphertext.length);
		result[0] = CURRENT_AES_VERSION;
		result.set(salt, 1);
		result.set(iv, 1 + salt.length);
		result.set(ciphertext, 1 + salt.length + iv.length);

		return bytesToBase64(result);
	}

	static decrypt(password: string, encoded: string): string {
		const data = base64ToBytes(encoded);
		if (data.length < 1 + SALT_LENGTH + IV_LENGTH) {
			throw new Error("Invalid ciphertext");
		}

		const version = data[0];
		const iterations = iterationsForVersion(version);

		const saltStart = 1;
		const saltEnd = saltStart + SALT_LENGTH;
		const ivEnd = saltEnd + IV_LENGTH;

		const salt = data.slice(saltStart, saltEnd);
		const iv = data.slice(saltEnd, ivEnd);
		const ciphertext = data.slice(ivEnd);

		const key = deriveKey(password, salt, iterations);

		const decipher = gcm(key, iv);
		let plaintextBytes: Uint8Array;
		try {
			plaintextBytes = decipher.decrypt(ciphertext);
		} catch {
			throw new Error("Decryption failed");
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

function deriveKey(password: string, salt: Uint8Array, iterations: number): Uint8Array {
	const passwordBytes = encoder.encode(password);

	return pbkdf2(sha256, passwordBytes, salt, {
		c: iterations,
		dkLen: KEY_LENGTH,
	});
}
