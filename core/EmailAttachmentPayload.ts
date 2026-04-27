import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

export type EmailAttachmentCleartextEnvelope = {
	type: "ebp-email-attachment-cleartext-envelope";
	version: typeof FILE_FORMAT_VERSIONS.emailAttachmentCleartextEnvelope;
	attachmentId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	fileDataBase64: string;
	bodyPayloadHash?: string;
};

export type EncryptedEmailAttachmentPayload = {
	type: "ebp-encrypted-email-attachment";
	version: typeof FILE_FORMAT_VERSIONS.encryptedEmailAttachment;
	recipientFingerprint: string;
	attachmentId: string;
	ciphertext: string;
};

export type EncryptedSignedEmailAttachmentPayload = {
	type: "ebp-encrypted-signed-email-attachment";
	version: typeof FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachment;
	recipientFingerprint: string;
	senderFingerprint: string;
	attachmentId: string;
	ciphertext: string;
};

export type AnyEncryptedEmailAttachmentPayload =
	| EncryptedEmailAttachmentPayload
	| EncryptedSignedEmailAttachmentPayload;

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export function createEmailAttachmentCleartextEnvelope(input: {
	attachmentId: string;
	fileBytes: Uint8Array;
	fileName: string;
	mimeType?: string;
	bodyPayloadHash?: string;
}): EmailAttachmentCleartextEnvelope {
	return {
		type: "ebp-email-attachment-cleartext-envelope",
		version: FILE_FORMAT_VERSIONS.emailAttachmentCleartextEnvelope,
		attachmentId: input.attachmentId,
		fileName: input.fileName || "encrypted.bin",
		mimeType: input.mimeType || "application/octet-stream",
		fileSize: input.fileBytes.length,
		fileDataBase64: bytesToBase64(input.fileBytes),
		bodyPayloadHash: input.bodyPayloadHash,
	};
}

export function parseEmailAttachmentCleartextEnvelope(
	input: string,
): {
	attachmentId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	fileBytes: Uint8Array;
	bodyPayloadHash?: string;
} {
	const raw = JSON.parse(input) as Partial<EmailAttachmentCleartextEnvelope>;
	if (raw.type !== "ebp-email-attachment-cleartext-envelope") {
		throw new Error("Invalid email attachment envelope type");
	}
	if (raw.version !== FILE_FORMAT_VERSIONS.emailAttachmentCleartextEnvelope) {
		throw new Error("Unsupported email attachment envelope version");
	}
	if (!isNonEmptyString(raw.attachmentId)) {
		throw new Error("Invalid email attachment envelope attachmentId");
	}
	if (!isNonEmptyString(raw.fileName)) {
		throw new Error("Invalid email attachment envelope fileName");
	}
	if (!isNonEmptyString(raw.mimeType)) {
		throw new Error("Invalid email attachment envelope mimeType");
	}
	if (typeof raw.fileSize !== "number" || !Number.isInteger(raw.fileSize) || raw.fileSize < 0) {
		throw new Error("Invalid email attachment envelope fileSize");
	}
	if (!isNonEmptyString(raw.fileDataBase64)) {
		throw new Error("Invalid email attachment envelope fileDataBase64");
	}
	if (raw.bodyPayloadHash !== undefined && !isNonEmptyString(raw.bodyPayloadHash)) {
		throw new Error("Invalid email attachment envelope bodyPayloadHash");
	}
	const fileBytes = base64ToBytes(raw.fileDataBase64);
	if (fileBytes.length !== raw.fileSize) {
		throw new Error("Email attachment envelope size mismatch");
	}
	return {
		attachmentId: raw.attachmentId,
		fileName: raw.fileName,
		mimeType: raw.mimeType,
		fileSize: raw.fileSize,
		fileBytes,
		bodyPayloadHash: raw.bodyPayloadHash,
	};
}

export function parseEncryptedEmailAttachmentPayload(
	input: unknown,
): AnyEncryptedEmailAttachmentPayload {
	if (!input || typeof input !== "object") {
		throw new Error("Invalid encrypted email attachment payload");
	}
	const payload = input as Partial<AnyEncryptedEmailAttachmentPayload>;
	if (!isNonEmptyString(payload.type)) {
		throw new Error("Missing encrypted email attachment payload type");
	}
	if (!isNonEmptyString(payload.recipientFingerprint)) {
		throw new Error("Missing encrypted email attachment recipientFingerprint");
	}
	if (!isNonEmptyString(payload.attachmentId)) {
		throw new Error("Missing encrypted email attachment attachmentId");
	}
	if (!isNonEmptyString(payload.ciphertext)) {
		throw new Error("Missing encrypted email attachment ciphertext");
	}
	if (payload.type === "ebp-encrypted-email-attachment") {
		if (payload.version !== FILE_FORMAT_VERSIONS.encryptedEmailAttachment) {
			throw new Error("Unsupported encrypted email attachment version");
		}
		return {
			type: payload.type,
			version: payload.version,
			recipientFingerprint: payload.recipientFingerprint,
			attachmentId: payload.attachmentId,
			ciphertext: payload.ciphertext,
		};
	}
	if (payload.type === "ebp-encrypted-signed-email-attachment") {
		if (payload.version !== FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachment) {
			throw new Error("Unsupported signed encrypted email attachment version");
		}
		if (!isNonEmptyString(payload.senderFingerprint)) {
			throw new Error("Missing encrypted signed email attachment senderFingerprint");
		}
		return {
			type: payload.type,
			version: payload.version,
			recipientFingerprint: payload.recipientFingerprint,
			senderFingerprint: payload.senderFingerprint,
			attachmentId: payload.attachmentId,
			ciphertext: payload.ciphertext,
		};
	}
	throw new Error("Unsupported encrypted email attachment payload type");
}
