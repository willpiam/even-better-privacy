import { sha256 } from "@noble/hashes/sha2";

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sha256Hex(message: string): string {
	return toHex(sha256(textEncoder.encode(message)));
}

export function buildMessageHashEnvelopeFromHash(messageHash: string, salt?: string): string {
	return `ebp::messagehash::${messageHash}::${salt ?? ""}`;
}

export function buildMessageHashEnvelope(message: string, salt?: string): string {
	return buildMessageHashEnvelopeFromHash(sha256Hex(message), salt);
}
