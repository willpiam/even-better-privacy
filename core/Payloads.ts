import { FILE_FORMAT_VERSIONS } from "./version.ts";

export const EBP_MESSAGE_ARMOR_START = "-----BEGIN EBP MESSAGE-----";
export const EBP_MESSAGE_ARMOR_END = "-----END EBP MESSAGE-----";

export type EbpSignaturePayload = {
  type: "ebp-signature";
  version: typeof FILE_FORMAT_VERSIONS.signature;
  fingerprint: string;
  messageHash: string;
  salt: string;
  signature: string;
  identity?: Record<string, unknown>;
};

export type EbpSignedMessagePayload = {
  type: "ebp-signed-message";
  version: typeof FILE_FORMAT_VERSIONS.signedMessage;
  fingerprint: string;
  message: string;
  messageHash: string;
  salt: string;
  signature: string;
  identity?: Record<string, unknown>;
};

export type EbpEncryptedMessagePayload = {
  type: "ebp-encrypted-message";
  version: typeof FILE_FORMAT_VERSIONS.encryptedMessage;
  recipientFingerprint: string;
  ciphertext: string;
};

export type EbpEncryptedSignedMessagePayload = {
  type: "ebp-encrypted-signed-message";
  version: typeof FILE_FORMAT_VERSIONS.encryptedSignedMessage;
  recipientFingerprint: string;
  senderFingerprint: string;
  ciphertext: string;
  senderIdentity?: Record<string, unknown>;
};

export type AnyMessagePayload =
  | EbpSignaturePayload
  | EbpSignedMessagePayload
  | EbpEncryptedMessagePayload
  | EbpEncryptedSignedMessagePayload;

export function buildDetachedSignaturePayload(input: {
  fingerprint: string;
  messageHash: string;
  salt: string;
  signature: string;
  identity?: Record<string, unknown>;
}): EbpSignaturePayload {
  return {
    type: "ebp-signature",
    version: FILE_FORMAT_VERSIONS.signature,
    fingerprint: input.fingerprint,
    messageHash: input.messageHash,
    salt: input.salt,
    signature: input.signature,
    identity: input.identity,
  };
}

export function buildSignedMessagePayload(input: {
  fingerprint: string;
  message: string;
  messageHash: string;
  salt: string;
  signature: string;
  identity?: Record<string, unknown>;
}): EbpSignedMessagePayload {
  return {
    type: "ebp-signed-message",
    version: FILE_FORMAT_VERSIONS.signedMessage,
    fingerprint: input.fingerprint,
    message: input.message,
    messageHash: input.messageHash,
    salt: input.salt,
    signature: input.signature,
    identity: input.identity,
  };
}

export function buildEncryptedMessagePayload(input: {
  recipientFingerprint: string;
  ciphertext: string;
}): EbpEncryptedMessagePayload {
  return {
    type: "ebp-encrypted-message",
    version: FILE_FORMAT_VERSIONS.encryptedMessage,
    recipientFingerprint: input.recipientFingerprint,
    ciphertext: input.ciphertext,
  };
}

export function buildEncryptedSignedMessagePayload(input: {
  recipientFingerprint: string;
  senderFingerprint: string;
  ciphertext: string;
  senderIdentity?: Record<string, unknown>;
}): EbpEncryptedSignedMessagePayload {
  return {
    type: "ebp-encrypted-signed-message",
    version: FILE_FORMAT_VERSIONS.encryptedSignedMessage,
    recipientFingerprint: input.recipientFingerprint,
    senderFingerprint: input.senderFingerprint,
    ciphertext: input.ciphertext,
    senderIdentity: input.senderIdentity,
  };
}

export function armorPayload(payload: unknown): string {
  return [EBP_MESSAGE_ARMOR_START, JSON.stringify(payload, null, 2), EBP_MESSAGE_ARMOR_END].join("\n");
}

export function extractArmoredPayload(text: string): Record<string, unknown> | null {
  const s = text.indexOf(EBP_MESSAGE_ARMOR_START);
  const e = text.indexOf(EBP_MESSAGE_ARMOR_END);
  if (s < 0 || e < 0 || e <= s) return null;
  const raw = text.slice(s + EBP_MESSAGE_ARMOR_START.length, e).trim();
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}
