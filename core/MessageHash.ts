import { sha256 } from "@noble/hashes/sha2";
import { toHex } from "./Hex.ts";

const textEncoder = new TextEncoder();

export function sha256Hex(message: string): string {
	return toHex(sha256(textEncoder.encode(message)));
}

export function buildMessageHashEnvelopeFromHash(messageHash: string, salt?: string): string {
	return `ebp::messagehash::${messageHash}::${salt ?? ""}`;
}

export function buildMessageHashEnvelope(message: string, salt?: string): string {
	return buildMessageHashEnvelopeFromHash(sha256Hex(message), salt);
}

// F-CRYPTO-02: recipient-bound envelope. Binding the intended recipient's
// fingerprint into the signed bytes defeats the Don Davis "surreptitious
// forwarding" attack: a valid signature only verifies when the verifier is
// the same identity the sender addressed.
export function buildRecipientBoundEnvelopeFromHash(
	recipientFingerprint: string,
	messageHash: string,
	salt?: string,
): string {
	return `ebp::messagehash::v2::${recipientFingerprint}::${messageHash}::${salt ?? ""}`;
}

export function buildRecipientBoundEnvelope(
	recipientFingerprint: string,
	message: string,
	salt?: string,
): string {
	return buildRecipientBoundEnvelopeFromHash(recipientFingerprint, sha256Hex(message), salt);
}
