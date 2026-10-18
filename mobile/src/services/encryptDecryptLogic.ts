/**
 * Pure encrypt/decrypt helpers (Deno/Jest-testable; no RNFS / storage).
 */
import type {Identity} from '../../../core/Identity.ts';

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
