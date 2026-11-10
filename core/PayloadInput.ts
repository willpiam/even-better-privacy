import { parseStrictJson } from "./StrictJson.ts";
import { extractArmoredPayload } from "./Payloads.ts";
import { FILE_FORMAT_VERSIONS } from "./version.ts";

function currentPayload(payload: Record<string, unknown>): Record<string, unknown> {
  // The current signed-file object is produced without a version field.
  if (payload.type === "ebp-signed-file" && payload.version === undefined) return payload;
  const versions: Record<string, number> = {
    "ebp-signature": FILE_FORMAT_VERSIONS.signature,
    "ebp-signed-message": FILE_FORMAT_VERSIONS.signedMessage,
    "ebp-encrypted-message": FILE_FORMAT_VERSIONS.encryptedMessage,
    "ebp-encrypted-signed-message": FILE_FORMAT_VERSIONS.encryptedSignedMessage,
    "ebp-encrypted-signed-message-multi": FILE_FORMAT_VERSIONS.encryptedSignedMessageMulti,
    "ebp-file-cleartext-envelope": FILE_FORMAT_VERSIONS.fileCleartextEnvelope,
    "ebp-encrypted-file": FILE_FORMAT_VERSIONS.encryptedFile,
    "ebp-encrypted-signed-file": FILE_FORMAT_VERSIONS.encryptedSignedFile,
    "ebp-email-attachment-cleartext-envelope": FILE_FORMAT_VERSIONS.emailAttachmentCleartextEnvelope,
    "ebp-encrypted-email-attachment": FILE_FORMAT_VERSIONS.encryptedEmailAttachment,
    "ebp-encrypted-signed-email-attachment": FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachment,
    "ebp-encrypted-signed-email-attachment-multi": FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachmentMulti,
    "ebp-emergency-revocation-certificate": FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
  };
  if (typeof payload.type !== "string" || !Object.prototype.hasOwnProperty.call(versions, payload.type) || payload.version !== versions[payload.type]) {
    throw new Error("Unsupported payload type or version");
  }
  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Parse user paste input: PEM-style armor block or raw JSON payload object.
 */
export function parseEbpPayloadInput(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Payload input is empty");
  }

  const armored = extractArmoredPayload(trimmed);
  if (armored) {
    if (typeof armored.type !== "string") {
      throw new Error("Armored payload missing type field");
    }
    return currentPayload(armored);
  }

  let parsed: unknown;
  try {
    parsed = parseStrictJson(trimmed);
  } catch {
    throw new Error("Invalid JSON payload");
  }

  if (!isRecord(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  if (typeof parsed.type !== "string") {
    throw new Error("Payload missing type field");
  }
  return currentPayload(parsed);
}

export type ParsedRecipientEncapsulation = {
  fingerprint: string;
  kemCiphertext: string;
  keyWrapNonce: string;
  wrappedContentKey: string;
};

export function parseMultiRecipientEntries(
  recipientsRaw: unknown,
): ParsedRecipientEncapsulation[] {
  if (!Array.isArray(recipientsRaw)) {
    return [];
  }
  return recipientsRaw
    .map((entry) => {
      const row = entry as Record<string, unknown> | null;
      return {
        fingerprint: typeof row?.fingerprint === "string" ? row.fingerprint : "",
        kemCiphertext: typeof row?.kemCiphertext === "string"
          ? row.kemCiphertext
          : "",
        keyWrapNonce: typeof row?.keyWrapNonce === "string"
          ? row.keyWrapNonce
          : "",
        wrappedContentKey: typeof row?.wrappedContentKey === "string"
          ? row.wrappedContentKey
          : "",
      };
    })
    .filter((entry) => (
      entry.fingerprint.length > 0 &&
      entry.kemCiphertext.length > 0 &&
      entry.keyWrapNonce.length > 0 &&
      entry.wrappedContentKey.length > 0
    ));
}
