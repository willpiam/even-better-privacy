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
const PBKDF2_ITERATIONS = 310_000; // strong default as of 2024
const KEY_LENGTH = 32; // 256 bits

export class AES {
	static encrypt(password: string, plaintext: string): string {
		const salt = randomBytes(SALT_LENGTH);
		const iv = randomBytes(IV_LENGTH);
		const key = deriveKey(password, salt);

		const data = encoder.encode(plaintext);
		const cipher = gcm(key, iv);
		const ciphertext = cipher.encrypt(data);

		// [version(1)] [salt] [iv] [ciphertext]
		const result = new Uint8Array(1 + salt.length + iv.length + ciphertext.length);
		result[0] = FILE_FORMAT_VERSIONS.aesCiphertext; // version
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
		if (version !== FILE_FORMAT_VERSIONS.aesCiphertext) {
			throw new Error("Unsupported ciphertext version");
		}

		const saltStart = 1;
		const saltEnd = saltStart + SALT_LENGTH;
		const ivEnd = saltEnd + IV_LENGTH;

		const salt = data.slice(saltStart, saltEnd);
		const iv = data.slice(saltEnd, ivEnd);
		const ciphertext = data.slice(ivEnd);

		const key = deriveKey(password, salt);

		const decipher = gcm(key, iv);
		let plaintextBytes: Uint8Array;
		try {
			plaintextBytes = decipher.decrypt(ciphertext);
		} catch {
			throw new Error("Decryption failed");
		}

		return decoder.decode(plaintextBytes);
	}
}

function deriveKey(password: string, salt: Uint8Array): Uint8Array {
	const passwordBytes = encoder.encode(password);

	return pbkdf2(sha256, passwordBytes, salt, {
		c: PBKDF2_ITERATIONS,
		dkLen: KEY_LENGTH,
	});
}
