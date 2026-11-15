import { MAX_ENCRYPTED_FILE_BYTES } from "../../common/FileLimits.ts";
import { type ExternalIdentity, Identity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { MultiRecipientCipher } from "../../core/MultiRecipientCipher.ts";
import { hexToBytes } from "../../core/Hex.ts";
import {
  buildEncryptedFilePayload,
  buildEncryptedSignedFilePayload,
  createFileCleartextEnvelope,
  parseFileCleartextEnvelope,
} from "../../core/FilePayload.ts";
import {
  parseEmailAttachmentCleartextEnvelope,
  parseEncryptedEmailAttachmentPayload,
} from "../../core/EmailAttachmentPayload.ts";
import { getContext } from "../../cli/utils.ts";
import {
  bytesToBase64,
  HttpError,
  json,
  readJson,
  safeFileName,
  STATUS,
} from "./http.ts";
import { loadIdentityForRequest } from "./unlock-session.ts";
import { loadContact } from "./contacts.ts";
import { tryResolveSenderForCtx } from "./sender-context.ts";

export async function handleFileRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/encrypt-file") {
    const body = await readJson<{
      recipient?: unknown;
      sign?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      fileName?: unknown;
      mimeType?: unknown;
      fileDataBase64?: unknown;
    }>(req);
    const recipient = typeof body.recipient === "string"
      ? body.recipient
      : undefined;
    const sign = Boolean(body.sign);
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const fileNameRaw = typeof body.fileName === "string"
      ? body.fileName
      : "encrypted.bin";
    const mimeType =
      typeof body.mimeType === "string" && body.mimeType.length > 0
        ? body.mimeType
        : "application/octet-stream";
    const fileDataBase64 = typeof body.fileDataBase64 === "string"
      ? body.fileDataBase64
      : undefined;
    if (!recipient) {
      throw new HttpError(STATUS.BadRequest, "recipient is required");
    }
    if (!fileDataBase64) {
      throw new HttpError(STATUS.BadRequest, "fileDataBase64 is required");
    }
    const fileBytes = Uint8Array.from(
      atob(fileDataBase64),
      (c) => c.charCodeAt(0),
    );
    if (fileBytes.length > MAX_ENCRYPTED_FILE_BYTES) {
      throw new HttpError(
        STATUS.BadRequest,
        `file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
      );
    }

    const ctx = await getContext(home, identityName);
    const contact = await loadContact(ctx, recipient);
    const fileName = safeFileName(fileNameRaw);
    const envelope = createFileCleartextEnvelope(
      fileBytes,
      fileName,
      mimeType,
    );
    const cleartext = JSON.stringify(envelope);

    if (sign) {
      const identity = await loadIdentityForRequest(ctx, password);
      const ciphertext = identity.signAndEncryptFor(cleartext, contact);
      return json(buildEncryptedSignedFilePayload({
        recipientFingerprint: contact.fingerprint,
        senderFingerprint: identity.toFingerprint(),
        fileName,
        mimeType,
        fileSize: fileBytes.length,
        ciphertext,
      }));
    }

    const ciphertext = Identity.EncryptFor(contact, cleartext);
    return json(buildEncryptedFilePayload({
      recipientFingerprint: contact.fingerprint,
      fileName,
      mimeType,
      fileSize: fileBytes.length,
      ciphertext,
    }));
  }

  if (req.method === "POST" && url.pathname === "/api/v1/decrypt-file") {
    const body = await readJson<{
      payload?: unknown;
      password?: unknown;
      sender?: unknown;
      home?: unknown;
      identity?: unknown;
    }>(req);
    const payload = body.payload as Record<string, unknown> | undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const sender = typeof body.sender === "string" ? body.sender : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    if (!payload) {
      throw new HttpError(STATUS.BadRequest, "payload is required");
    }
    const ciphertext = String(payload.ciphertext ?? "");
    if (!ciphertext) {
      throw new HttpError(STATUS.BadRequest, "payload missing ciphertext");
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);

    let cleartextEnvelopeRaw = "";
    let verified: boolean | null = null;
    let verifyStatus = "unsigned";
    if (payload.type === "ebp-encrypted-file") {
      try {
        cleartextEnvelopeRaw = identity.encryptionKey.decrypt(ciphertext);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - payload may be corrupted or not intended for this identity",
        );
      }
    } else if (payload.type === "ebp-encrypted-signed-file") {
      const senderFpFile = typeof payload.senderFingerprint === "string"
        ? payload.senderFingerprint
        : undefined;
      const embeddedFile = payload.senderIdentity as
        | Record<string, unknown>
        | undefined;
      const resolvedFile = await tryResolveSenderForCtx(ctx, {
        senderHint: sender,
        senderFingerprint: senderFpFile,
        embeddedIdentity: embeddedFile,
      });
      if (!resolvedFile) {
        throw new HttpError(
          STATUS.BadRequest,
          "sender is required for signed file payloads",
        );
      }
      const contact = resolvedFile.contact;
      let result: {
        message: string;
        verified: boolean;
        verifyStatus: string;
      };
      try {
        result = identity.decryptAndVerify(ciphertext, contact);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - payload may be corrupted or not intended for this identity",
        );
      }
      cleartextEnvelopeRaw = result.message;
      verified = result.verified;
      verifyStatus = result.verifyStatus;
    } else {
      throw new HttpError(STATUS.BadRequest, "unsupported file payload type");
    }

    const envelope = parseFileCleartextEnvelope(cleartextEnvelopeRaw);
    if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
      throw new HttpError(
        STATUS.BadRequest,
        `decrypted file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
      );
    }
    const fileDataBase64 = bytesToBase64(envelope.fileBytes);
    return json({
      fileName: safeFileName(envelope.fileName),
      mimeType: envelope.mimeType || "application/octet-stream",
      fileSize: envelope.fileSize,
      fileDataBase64,
      verified,
      verifyStatus,
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/v1/mail/decrypt-attachment"
  ) {
    const body = await readJson<{
      payload?: unknown;
      password?: unknown;
      sender?: unknown;
      home?: unknown;
      identity?: unknown;
      expectedBodyPayloadHash?: unknown;
      contentKey?: unknown;
      expectedAttachmentHash?: unknown;
    }>(req);
    const payloadInput = body.payload;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const sender = typeof body.sender === "string" ? body.sender : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const expectedBodyPayloadHash =
      typeof body.expectedBodyPayloadHash === "string"
        ? body.expectedBodyPayloadHash
        : undefined;
    const contentKey = typeof body.contentKey === "string"
      ? body.contentKey
      : undefined;
    const expectedAttachmentHash =
      typeof body.expectedAttachmentHash === "string"
        ? body.expectedAttachmentHash
        : undefined;
    if (!payloadInput) {
      throw new HttpError(STATUS.BadRequest, "payload is required");
    }
    const payload = parseEncryptedEmailAttachmentPayload(payloadInput);

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    let cleartextEnvelopeRaw = "";
    let verified: boolean | null = null;
    let verifyStatus = "unsigned";

    if (payload.type === "ebp-encrypted-email-attachment") {
      try {
        cleartextEnvelopeRaw = identity.encryptionKey.decrypt(
          payload.ciphertext,
        );
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - attachment may be corrupted or not intended for this identity",
        );
      }
    } else if (payload.type === "ebp-encrypted-signed-email-attachment") {
      let contact: ExternalIdentity;
      if (sender) {
        contact = await loadContact(ctx, sender);
      } else {
        contact = await loadContact(
          ctx,
          payload.senderFingerprint.substring(0, 16),
        );
      }
      let result: {
        message: string;
        verified: boolean;
        verifyStatus: string;
      };
      try {
        result = identity.decryptAndVerify(payload.ciphertext, contact);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - attachment may be corrupted or not intended for this identity",
        );
      }
      cleartextEnvelopeRaw = result.message;
      verified = result.verified;
      verifyStatus = result.verifyStatus;
    } else if (
      payload.type === "ebp-encrypted-signed-email-attachment-multi"
    ) {
      if (!contentKey) {
        throw new HttpError(
          STATUS.BadRequest,
          "contentKey is required for multi-recipient attachments",
        );
      }
      if (sender) {
        await loadContact(ctx, sender);
      } else {
        await loadContact(ctx, payload.senderFingerprint.substring(0, 16));
      }
      try {
        const cleartextBytes = MultiRecipientCipher.decryptWithContentKey(
          payload.ciphertext,
          payload.contentNonce,
          hexToBytes(contentKey),
        );
        cleartextEnvelopeRaw = new TextDecoder().decode(cleartextBytes);
      } catch {
        throw new HttpError(
          STATUS.BadRequest,
          "decryption failed - attachment may be corrupted or not intended for this identity",
        );
      }
      verified = null;
      verifyStatus = "valid";
    } else {
      throw new HttpError(
        STATUS.BadRequest,
        "unsupported encrypted email attachment payload type",
      );
    }

    const envelope = parseEmailAttachmentCleartextEnvelope(
      cleartextEnvelopeRaw,
    );
    if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
      throw new HttpError(
        STATUS.BadRequest,
        `decrypted attachment exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
      );
    }
    const manifestMatched = expectedBodyPayloadHash
      ? envelope.bodyPayloadHash === expectedBodyPayloadHash
      : null;
    if (manifestMatched === false) {
      verifyStatus = "manifest_mismatch";
    }
    if (
      expectedAttachmentHash &&
      expectedAttachmentHash !== sha256Hex(payload.ciphertext)
    ) {
      verifyStatus = "manifest_mismatch";
    }
    const fileDataBase64 = bytesToBase64(envelope.fileBytes);
    return json({
      attachmentId: envelope.attachmentId,
      fileName: safeFileName(envelope.fileName),
      mimeType: envelope.mimeType || "application/octet-stream",
      fileSize: envelope.fileSize,
      fileDataBase64,
      verified,
      verifyStatus,
      bodyPayloadHash: envelope.bodyPayloadHash ?? null,
      manifestMatched,
    });
  }

  return null;
}
