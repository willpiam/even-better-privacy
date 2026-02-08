import { bytesToBase64, base64ToBytes } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const SALT_LENGTH = 16; // 128-bit salt
const IV_LENGTH = 12; // 96-bit IV for AES-GCM
const PBKDF2_ITERATIONS = 310_000; // strong default as of 2024

export class AES {
	static async encrypt(password: string, plaintext: string): Promise<string> {
		const versionTag = FILE_FORMAT_VERSIONS.aesCiphertext;
		const versionBytes = encoder.encode(versionTag);
		if (versionBytes.length > 255) {
			throw new Error("Ciphertext version tag too long");
		}
		const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
		const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
		const key = await deriveKey(password, salt);

		const data = encoder.encode(plaintext);
		const ciphertext = new Uint8Array(
			await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv },
				key,
				data,
			),
		);

		// [versionLen(1)] [version] [salt] [iv] [ciphertext]
		const result = new Uint8Array(1 + versionBytes.length + salt.length + iv.length + ciphertext.length);
		result[0] = versionBytes.length;
		result.set(versionBytes, 1);
		const saltOffset = 1 + versionBytes.length;
		result.set(salt, saltOffset);
		const ivOffset = saltOffset + salt.length;
		result.set(iv, ivOffset);
		result.set(ciphertext, ivOffset + iv.length);

		return bytesToBase64(result);
	}

	static async decrypt(password: string, encoded: string): Promise<string> {
		const data = base64ToBytes(encoded);
		if (data.length < 1 + SALT_LENGTH + IV_LENGTH) {
			throw new Error("Invalid ciphertext");
		}

		const versionLen = data[0];
		if (data.length < 1 + versionLen + SALT_LENGTH + IV_LENGTH) {
			throw new Error("Invalid ciphertext");
		}
		const versionStart = 1;
		const versionEnd = versionStart + versionLen;
		const version = decoder.decode(data.slice(versionStart, versionEnd));
		if (version !== FILE_FORMAT_VERSIONS.aesCiphertext) {
			throw new Error("Unsupported ciphertext version");
		}

		const saltStart = versionEnd;
		const saltEnd = saltStart + SALT_LENGTH;
		const ivEnd = saltEnd + IV_LENGTH;

		const salt = data.slice(saltStart, saltEnd);
		const iv = data.slice(saltEnd, ivEnd);
		const ciphertext = data.slice(ivEnd);

		const key = await deriveKey(password, salt);

		let plaintextBytes: ArrayBuffer;
		try {
			plaintextBytes = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv },
				key,
				ciphertext,
			);
		} catch {
			throw new Error("Decryption failed");
		}

		return decoder.decode(plaintextBytes);
	}
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
	const passwordBytes = encoder.encode(password);

	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		passwordBytes.buffer as ArrayBuffer,
		"PBKDF2",
		false,
		["deriveKey"],
	);

	return await crypto.subtle.deriveKey(
		{
			name: "PBKDF2",
			salt: salt.buffer as ArrayBuffer,
			iterations: PBKDF2_ITERATIONS,
			hash: "SHA-256",
		},
		keyMaterial,
		{
			name: "AES-GCM",
			length: 256,
		},
		false,
		["encrypt", "decrypt"],
	);
}


