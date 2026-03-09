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
