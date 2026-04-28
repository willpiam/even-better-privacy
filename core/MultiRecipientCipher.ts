import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import type { ExternalIdentity } from "./ExternalIdentity.ts";
import { KyberEncryptionKey } from "./Kyber.ts";
import { hexToBytes, toHex } from "./Hex.ts";

const CONTENT_KEY_SIZE = 32;
const NONCE_SIZE = 12;

const CIPHERTEXT_SIZES: Record<string, number> = {
	ml_kem512: 768,
	ml_kem768: 1088,
	ml_kem1024: 1568,
};

export type RecipientEncapsulation = {
	fingerprint: string;
	kemCiphertext: string;
	keyWrapNonce: string;
	wrappedContentKey: string;
};

export class MultiRecipientCipher {
	static encryptForMany(
		plaintext: Uint8Array,
		recipients: ExternalIdentity[],
		options?: { contentKey?: Uint8Array },
	): {
		recipients: RecipientEncapsulation[];
		contentNonce: string;
		ciphertext: string;
		contentKey: Uint8Array;
	} {
		if (!Array.isArray(recipients) || recipients.length === 0) {
			throw new Error("at least one recipient is required");
		}
		const uniqueRecipients = dedupeRecipients(recipients);
		const contentKey = options?.contentKey ?? randomBytes(CONTENT_KEY_SIZE);
		if (contentKey.length !== CONTENT_KEY_SIZE) {
			throw new Error("content key must be 32 bytes");
		}
		const { contentNonce, ciphertext } = MultiRecipientCipher.encryptWithContentKey(plaintext, contentKey);
		const entries = uniqueRecipients.map((recipient) => MultiRecipientCipher.wrapContentKeyForRecipient(contentKey, recipient));
		return { recipients: entries, contentNonce, ciphertext, contentKey };
	}

	static wrapContentKeyForRecipient(contentKey: Uint8Array, recipient: ExternalIdentity): RecipientEncapsulation {
		if (recipient.encryptionKeyType !== "kyber") {
			throw new Error(`unsupported encryption key type: ${recipient.encryptionKeyType}`);
		}
		const wrapped = KyberEncryptionKey.EncryptFor(recipient, toHex(contentKey));
		const parts = splitKyberCiphertext(wrapped, recipient.encryptionKeyDetails?.variant ?? "ml_kem1024");
		return {
			fingerprint: recipient.fingerprint,
			kemCiphertext: toHex(parts.kemCiphertext),
			keyWrapNonce: toHex(parts.nonce),
			wrappedContentKey: toHex(parts.ciphertext),
		};
	}

	static unwrapContentKey(entry: RecipientEncapsulation, myKey: KyberEncryptionKey): Uint8Array {
		const packed = `${entry.kemCiphertext}${entry.keyWrapNonce}${entry.wrappedContentKey}`;
		let contentKeyHex = "";
		try {
			contentKeyHex = myKey.decrypt(packed);
		} catch {
			throw new Error("failed to unwrap content key");
		}
		const contentKey = hexToBytes(contentKeyHex);
		if (contentKey.length !== CONTENT_KEY_SIZE) {
			throw new Error("invalid wrapped content key size");
		}
		return contentKey;
	}

	static encryptWithContentKey(
		plaintext: Uint8Array,
		contentKey: Uint8Array,
	): {
		contentNonce: string;
		ciphertext: string;
	} {
		if (contentKey.length !== CONTENT_KEY_SIZE) {
			throw new Error("content key must be 32 bytes");
		}
		const nonce = randomBytes(NONCE_SIZE);
		const cipher = gcm(contentKey, nonce);
		const ciphertext = cipher.encrypt(plaintext);
		return {
			contentNonce: toHex(nonce),
			ciphertext: toHex(ciphertext),
		};
	}

	static decryptWithContentKey(ciphertextHex: string, contentNonceHex: string, contentKey: Uint8Array): Uint8Array {
		if (contentKey.length !== CONTENT_KEY_SIZE) {
			throw new Error("content key must be 32 bytes");
		}
		const ciphertext = hexToBytes(ciphertextHex);
		const nonce = hexToBytes(contentNonceHex);
		if (nonce.length !== NONCE_SIZE) {
			throw new Error("invalid content nonce size");
		}
		const decipher = gcm(contentKey, nonce);
		return decipher.decrypt(ciphertext);
	}
}

function splitKyberCiphertext(
	ciphertextHex: string,
	variant: string,
): { kemCiphertext: Uint8Array; nonce: Uint8Array; ciphertext: Uint8Array } {
	const size = CIPHERTEXT_SIZES[variant];
	if (!size) {
		throw new Error(`invalid kyber variant: ${variant}`);
	}
	const data = hexToBytes(ciphertextHex);
	if (data.length <= size + NONCE_SIZE) {
		throw new Error("invalid wrapped key payload length");
	}
	return {
		kemCiphertext: data.subarray(0, size),
		nonce: data.subarray(size, size + NONCE_SIZE),
		ciphertext: data.subarray(size + NONCE_SIZE),
	};
}

function dedupeRecipients(recipients: ExternalIdentity[]): ExternalIdentity[] {
	const seen = new Set<string>();
	const out: ExternalIdentity[] = [];
	for (const recipient of recipients) {
		if (seen.has(recipient.fingerprint)) continue;
		seen.add(recipient.fingerprint);
		out.push(recipient);
	}
	return out;
}
