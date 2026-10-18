/**
 * Pure sign/verify helpers (Deno-testable; no RNFS / storage).
 * Mobile UI wrappers in signVerify.ts load identities then call these.
 */
import {sha256} from '@noble/hashes/sha2';
import {Identity} from '../../../core/Identity.ts';
import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {toHex} from '../../../core/Hex.ts';
import {randomHex, buildFileSignMessage} from '../../../core/CryptoUtils.ts';
import {
  buildDetachedSignaturePayload,
  buildSignedMessagePayload,
} from '../../../core/Payloads.ts';

export type SignMessageOptions = {
  detached?: boolean;
  includeIdentity?: boolean;
  includeSalt?: boolean;
  salt?: string;
};

function hashTextSha256Hex(value: string): string {
  return toHex(sha256(new TextEncoder().encode(value)));
}

export function resolveSignSalt(options?: SignMessageOptions): string {
  const includeSalt = options?.includeSalt ?? true;
  return options?.salt ?? (includeSalt ? randomHex(16) : '');
}

export function signMessageWithIdentity(
  identity: Identity,
  message: string,
  options?: SignMessageOptions,
): Record<string, unknown> {
  if (!message) {
    throw new Error('Message is required');
  }
  const salt = resolveSignSalt(options);
  const signature = identity.signMessage(message, salt);
  const messageHash = hashTextSha256Hex(message);
  const summary = identity.summary;
  const identityPayload = options?.includeIdentity
    ? {
        fingerprint: summary.fingerprint,
        signingKeyType: summary.signingKeyType,
        encryptionKeyType: summary.encryptionKeyType,
        signingKey: summary.signingKey,
        encryptionKey: summary.encryptionKey,
        signingKeyDetails: summary.signingKeyDetails,
        encryptionKeyDetails: summary.encryptionKeyDetails,
      }
    : undefined;
  if (options?.detached) {
    return buildDetachedSignaturePayload({
      fingerprint: identity.toFingerprint(),
      messageHash,
      salt,
      signature,
      identity: identityPayload,
    }) as Record<string, unknown>;
  }
  return buildSignedMessagePayload({
    fingerprint: identity.toFingerprint(),
    message,
    messageHash,
    salt,
    signature,
    identity: identityPayload,
  }) as Record<string, unknown>;
}

export function verifyMessagePayload(params: {
  payload: Record<string, unknown>;
  message?: string;
  publicIdentity: ExternalIdentity;
}): {verified: boolean} {
  const payload = params.payload;
  let message = '';
  let messageHash = '';
  let signature = '';
  let salt = '';
  if (payload.type === 'ebp-signed-message') {
    message = String(payload.message ?? '');
    messageHash = String(payload.messageHash ?? '');
    signature = String(payload.signature ?? '');
    salt = String(payload.salt ?? '');
  } else if (payload.type === 'ebp-signature') {
    message = params.message ?? '';
    messageHash = String(payload.messageHash ?? '');
    signature = String(payload.signature ?? '');
    salt = String(payload.salt ?? '');
  } else {
    throw new Error('Unsupported payload type');
  }
  if (!message || !messageHash || !signature) {
    throw new Error('Payload missing required fields');
  }
  if (hashTextSha256Hex(message) !== messageHash) {
    throw new Error('Message hash mismatch');
  }
  if (!params.publicIdentity.signingKey) {
    throw new Error('public identity missing signing key');
  }
  const verified = Identity.VerifySignature(
    params.publicIdentity,
    message,
    signature,
    salt,
  );
  return {verified};
}

export function resolveFileSignSalt(includeSalt?: boolean): string {
  return includeSalt === false ? '' : randomHex(16);
}

export function signFileBytesWithIdentity(params: {
  identity: Identity;
  fileBytes: Uint8Array;
  fileName: string;
  contextMessage?: string;
  includeSalt?: boolean;
}): {
  payload: Record<string, unknown>;
  fileHash: string;
  signedMessage: string;
  salt: string;
} {
  const fileHash = toHex(sha256(params.fileBytes));
  const salt = resolveFileSignSalt(params.includeSalt);
  const signedMessage = buildFileSignMessage(
    fileHash,
    salt,
    params.contextMessage ?? '',
  );
  const signature = params.identity.signMessage(signedMessage);
  const payload = {
    type: 'ebp-signed-file',
    fingerprint: params.identity.toFingerprint(),
    fileName: params.fileName,
    fileHash,
    salt,
    contextMessage: params.contextMessage ?? '',
    signature,
    identity: params.identity.summary,
  };
  return {payload, fileHash, signedMessage, salt};
}
