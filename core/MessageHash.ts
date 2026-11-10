import { sha256 } from "@noble/hashes/sha2";
import { toHex } from "./Hex.ts";
import { canonicalJsonStringify } from "./CanonicalJson.ts";

const textEncoder = new TextEncoder();

export type SignaturePurpose = "message" | "detail-proof" | "revocation" | "hierarchy";

export function sha256Hex(message: string): string {
	return toHex(sha256(textEncoder.encode(message)));
}

function purposePrefix(purpose: SignaturePurpose): string {
	switch (purpose) {
		case "message":
			return "ebp::message::v1::";
		case "detail-proof":
			return "ebp::detail-proof::v2::";
		case "revocation":
			return "ebp::revocation::v2::";
		case "hierarchy":
			return "ebp::hierarchy::v2::";
	}
}

export function buildLegacyMessageHashEnvelopeFromHash(messageHash: string, salt?: string): string {
	return `ebp::messagehash::${messageHash}::${salt ?? ""}`;
}

export function buildPurposeHashEnvelopeFromHash(
	purpose: SignaturePurpose,
	messageHash: string,
	salt?: string,
): string {
	return `${purposePrefix(purpose)}${messageHash}::${salt ?? ""}`;
}

export function buildPurposeHashEnvelope(
	purpose: SignaturePurpose,
	message: string,
	salt?: string,
): string {
	return buildPurposeHashEnvelopeFromHash(purpose, sha256Hex(message), salt);
}

export function buildMessageHashEnvelopeFromHash(messageHash: string, salt?: string): string {
	return buildPurposeHashEnvelopeFromHash("message", messageHash, salt);
}

export function buildMessageHashEnvelope(message: string, salt?: string): string {
	return buildPurposeHashEnvelope("message", message, salt);
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

export type MultiRecipientAttachmentManifestEntry = {
	attachmentId: string;
	ciphertextSha256: string;
};

export function compareAttachmentEntries(a: MultiRecipientAttachmentManifestEntry, b: MultiRecipientAttachmentManifestEntry): number {
  const compare = (x: string, y: string) => x < y ? -1 : x > y ? 1 : 0;
  return compare(a.attachmentId, b.attachmentId) || compare(a.ciphertextSha256, b.ciphertextSha256);
}

export function buildMultiRecipientBoundEnvelope(
	recipientFingerprints: string[],
	message: string,
	attachmentManifest?: MultiRecipientAttachmentManifestEntry[],
	salt?: string,
): string {
	const canonicalRecipients = [...recipientFingerprints]
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
		.sort();
	const canonicalManifest = (attachmentManifest ?? [])
		.map((item) => ({
			attachmentId: item.attachmentId,
			ciphertextSha256: item.ciphertextSha256,
		}))
		.sort(compareAttachmentEntries);
	const canonicalJson = canonicalJsonStringify({
		tag: "EBP-MULTIRECIPIENT-V4",
		message,
		recipientFingerprints: canonicalRecipients,
		attachmentManifest: canonicalManifest,
	});
	const canonicalHash = sha256Hex(canonicalJson);
	return `ebp::messagehash::v4::${canonicalHash}::${salt ?? ""}`;
}
