import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

export const MAX_ENCRYPTED_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB soft bound for local API/UI flows

export type FileCleartextEnvelope = {
	type: "ebp-file-cleartext-envelope";
	version: typeof FILE_FORMAT_VERSIONS.fileCleartextEnvelope;
	fileName: string;
	mimeType: string;
	fileSize: number;
	fileDataBase64: string;
};

export type EncryptedFilePayload = {
	type: "ebp-encrypted-file";
	version: typeof FILE_FORMAT_VERSIONS.encryptedFile;
	recipientFingerprint: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	ciphertext: string;
};

export type EncryptedSignedFilePayload = {
	type: "ebp-encrypted-signed-file";
	version: typeof FILE_FORMAT_VERSIONS.encryptedSignedFile;
	recipientFingerprint: string;
	senderFingerprint: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	ciphertext: string;
};

export type AnyEncryptedFilePayload = EncryptedFilePayload | EncryptedSignedFilePayload;

export function createFileCleartextEnvelope(
	fileBytes: Uint8Array,
	fileName: string,
	mimeType = "application/octet-stream",
): FileCleartextEnvelope {
	return {
		type: "ebp-file-cleartext-envelope",
		version: FILE_FORMAT_VERSIONS.fileCleartextEnvelope,
		fileName: fileName || "encrypted.bin",
		mimeType: mimeType || "application/octet-stream",
		fileSize: fileBytes.length,
		fileDataBase64: bytesToBase64(fileBytes),
	};
}

export function parseFileCleartextEnvelope(
	input: string,
): { fileName: string; mimeType: string; fileSize: number; fileBytes: Uint8Array } {
	const raw = JSON.parse(input) as Partial<FileCleartextEnvelope>;
	if (raw.type !== "ebp-file-cleartext-envelope") {
		throw new Error("Invalid file envelope type");
	}
	if (raw.version !== FILE_FORMAT_VERSIONS.fileCleartextEnvelope) {
		throw new Error("Unsupported file envelope version");
	}
	if (typeof raw.fileName !== "string" || raw.fileName.length === 0) {
		throw new Error("Invalid file envelope fileName");
	}
	if (typeof raw.mimeType !== "string" || raw.mimeType.length === 0) {
		throw new Error("Invalid file envelope mimeType");
	}
	if (typeof raw.fileSize !== "number" || !Number.isInteger(raw.fileSize) || raw.fileSize < 0) {
		throw new Error("Invalid file envelope fileSize");
	}
	if (typeof raw.fileDataBase64 !== "string" || raw.fileDataBase64.length === 0) {
		throw new Error("Invalid file envelope fileDataBase64");
	}
	const fileBytes = base64ToBytes(raw.fileDataBase64);
	if (fileBytes.length !== raw.fileSize) {
		throw new Error("File envelope size mismatch");
	}
	return {
		fileName: raw.fileName,
		mimeType: raw.mimeType,
		fileSize: raw.fileSize,
		fileBytes,
	};
}
