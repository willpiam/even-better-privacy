/**
 * Pure encrypt/decrypt helpers (Deno/Jest-testable; no RNFS / storage).
 */
import {Identity} from '../../../core/Identity.ts';
import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
} from '../../../core/Payloads.ts';

export function normalizeFileUri(uri: string): string {
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
}

export function publicIdentityBlock(
  identity: Identity,
): Record<string, unknown> {
  const summary = identity.summary;
  return {
    fingerprint: summary.fingerprint,
    signingKeyType: summary.signingKeyType,
    encryptionKeyType: summary.encryptionKeyType,
    signingKey: summary.signingKey,
    encryptionKey: summary.encryptionKey,
    signingKeyDetails: summary.signingKeyDetails,
    encryptionKeyDetails: summary.encryptionKeyDetails,
  };
}

export function requireCiphertext(
  payload: Record<string, unknown>,
): string {
  const ciphertext = String(payload.ciphertext ?? '');
  if (!ciphertext) {
    throw new Error('Payload missing ciphertext');
  }
  return ciphertext;
}

export function senderFieldsFromPayload(payload: Record<string, unknown>): {
  senderFingerprint?: string;
  embeddedIdentity?: Record<string, unknown>;
} {
  const senderFingerprint =
    typeof payload.senderFingerprint === 'string'
      ? payload.senderFingerprint
      : undefined;
  const embeddedIdentity =
    payload.senderIdentity && typeof payload.senderIdentity === 'object'
      ? (payload.senderIdentity as Record<string, unknown>)
      : undefined;
  return {senderFingerprint, embeddedIdentity};
}

export function isEncryptedMessageType(type: unknown): boolean {
  return type === 'ebp-encrypted-message';
}

export function isEncryptedSignedMessageType(type: unknown): boolean {
  return type === 'ebp-encrypted-signed-message';
}

export function isEncryptedSignedMessageMultiType(type: unknown): boolean {
  return type === 'ebp-encrypted-signed-message-multi';
}

export function isEncryptedFileType(type: unknown): boolean {
  return type === 'ebp-encrypted-file';
}

export function isEncryptedSignedFileType(type: unknown): boolean {
  return type === 'ebp-encrypted-signed-file';
}

export function encryptMessageWithIdentity(params: {
  message: string;
  recipient: ExternalIdentity;
  identity?: Identity;
  sign?: boolean;
}): Record<string, unknown> {
  if (!params.message) {
    throw new Error('Message is required');
  }
  if (!params.recipient?.fingerprint) {
    throw new Error('Recipient is required');
  }
  if (params.sign) {
    if (!params.identity) {
      throw new Error('Password is required when signing');
    }
    const ciphertext = params.identity.signAndEncryptFor(
      params.message,
      params.recipient,
    );
    return buildEncryptedSignedMessagePayload({
      recipientFingerprint: params.recipient.fingerprint,
      senderFingerprint: params.identity.toFingerprint(),
      ciphertext,
      senderIdentity: publicIdentityBlock(params.identity),
    }) as Record<string, unknown>;
  }
  const ciphertext = Identity.EncryptFor(params.recipient, params.message);
  return buildEncryptedMessagePayload({
    recipientFingerprint: params.recipient.fingerprint,
    ciphertext,
  }) as Record<string, unknown>;
}

export function decryptMessageWithIdentity(params: {
  identity: Identity;
  payload: Record<string, unknown>;
  sender?: ExternalIdentity | null;
}): {
  message: string;
  verified: boolean | null;
  verifyStatus: 'unsigned' | 'valid' | 'valid_unbound' | 'invalid';
} {
  const ciphertext = requireCiphertext(params.payload);
  if (isEncryptedMessageType(params.payload.type)) {
    return {
      message: params.identity.encryptionKey.decrypt(ciphertext),
      verified: null,
      verifyStatus: 'unsigned',
    };
  }
  if (isEncryptedSignedMessageType(params.payload.type)) {
    if (!params.sender) {
      throw new Error('Sender required to verify signature');
    }
    const result = params.identity.decryptAndVerify(ciphertext, params.sender);
    return {
      message: result.message,
      verified: result.verified,
      verifyStatus: result.verifyStatus,
    };
  }
  throw new Error('Unsupported payload type');
}
