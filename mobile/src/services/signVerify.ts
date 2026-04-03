import RNFS from 'react-native-fs';
import {sha256} from '@noble/hashes/sha2';
import {
  Identity,
  toHex,
  base64ToBytes,
  buildDetachedSignaturePayload,
  buildSignedMessagePayload,
  type ExternalIdentity,
} from '../ebpCore';
import {loadContact} from './contacts';
import {loadIdentity, readIdentityRaw} from './storage';

function hashTextSha256Hex(value: string): string {
  return toHex(sha256(new TextEncoder().encode(value)));
}

function normalizeFileUri(uri: string): string {
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
}

export type SignMessageOptions = {
  detached?: boolean;
  includeIdentity?: boolean;
  includeSalt?: boolean;
  salt?: string;
};

export async function signMessage(params: {
  identityName: string;
  password: string;
  message: string;
  options?: SignMessageOptions;
}): Promise<Record<string, unknown>> {
  if (!params.message) {
    throw new Error('Message is required');
  }
  const identity = await loadIdentity(params.identityName, params.password);
  const includeSalt = params.options?.includeSalt ?? true;
  const salt =
    params.options?.salt ?? (includeSalt ? Math.random().toString(16).slice(2) : '');
  const signature = identity.signMessage(params.message, salt);
  const messageHash = hashTextSha256Hex(params.message);
  const summary = identity.summary;
  const identityPayload = params.options?.includeIdentity
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
  if (params.options?.detached) {
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
    message: params.message,
    messageHash,
    salt,
    signature,
    identity: identityPayload,
  }) as Record<string, unknown>;
}

export async function verifyMessage(params: {
  payload: Record<string, unknown>;
  message?: string;
  sender?: string;
  publicIdentity?: ExternalIdentity;
}): Promise<{verified: boolean}> {
  const payload = params.payload;
  let message = '';
  let messageHash = '';
  let signature = '';
  let salt = '';
  let fingerprint = '';
  if (payload.type === 'ebp-signed-message') {
    message = String(payload.message ?? '');
    messageHash = String(payload.messageHash ?? '');
    signature = String(payload.signature ?? '');
    salt = String(payload.salt ?? '');
    fingerprint = String(payload.fingerprint ?? '');
  } else if (payload.type === 'ebp-signature') {
    message = params.message ?? '';
    messageHash = String(payload.messageHash ?? '');
    signature = String(payload.signature ?? '');
    salt = String(payload.salt ?? '');
    fingerprint = String(payload.fingerprint ?? '');
  } else {
    throw new Error('Unsupported payload type');
  }
  if (!message || !messageHash || !signature) {
    throw new Error('Payload missing required fields');
  }
  if (hashTextSha256Hex(message) !== messageHash) {
    throw new Error('Message hash mismatch');
  }
  const senderIdentity =
    params.publicIdentity ??
    (await loadContact(params.sender ?? fingerprint.slice(0, 16)));
  const verified = Identity.VerifySignature(senderIdentity, message, signature, salt);
  return {verified};
}

export async function signFile(params: {
  identityName: string;
  password: string;
  fileUri: string;
  contextMessage?: string;
  includeSalt?: boolean;
}): Promise<{
  payload: Record<string, unknown>;
  fileHash: string;
  signedMessage: string;
  salt: string;
}> {
  const identity = await loadIdentity(params.identityName, params.password);
  const path = normalizeFileUri(params.fileUri);
  const base64 = await RNFS.readFile(path, 'base64');
  const bytes = base64ToBytes(base64);
  const fileHash = toHex(sha256(bytes));
  const salt =
    params.includeSalt === false ? '' : Math.random().toString(16).slice(2);
  const signedMessage = [
    'ebp::filehash',
    fileHash,
    salt,
    params.contextMessage ?? '',
  ].join('::');
  const signature = identity.signMessage(signedMessage);
  const payload = {
    type: 'ebp-signed-file',
    fingerprint: identity.toFingerprint(),
    fileHash,
    salt,
    contextMessage: params.contextMessage ?? '',
    signature,
    identity: identity.summary,
  };
  return {payload, fileHash, signedMessage, salt};
}

export async function verifyFileSignature(params: {
  fileUri: string;
  payload: Record<string, unknown>;
}): Promise<{
  verified: boolean;
  details: string;
  signedMessage: string;
}> {
  const path = normalizeFileUri(params.fileUri);
  const base64 = await RNFS.readFile(path, 'base64');
  const bytes = base64ToBytes(base64);
  const computedHash = toHex(sha256(bytes));
  const payload = params.payload;
  if (payload.type !== 'ebp-signed-file') {
    throw new Error('Signature payload type must be "ebp-signed-file"');
  }
  const fileHash = String(payload.fileHash ?? '');
  const salt = String(payload.salt ?? '');
  const contextMessage = String(payload.contextMessage ?? '');
  const signature = String(payload.signature ?? '');
  const identity = payload.identity as ExternalIdentity | undefined;
  if (!fileHash || !signature || !identity) {
    throw new Error('Invalid signed file payload');
  }
  if (fileHash !== computedHash) {
    return {
      verified: false,
      details: `File hash mismatch.\nExpected: ${fileHash}\nComputed: ${computedHash}`,
      signedMessage: '',
    };
  }
  const signedMessage = ['ebp::filehash', computedHash, salt, contextMessage].join('::');
  const verified = Identity.VerifySignature(identity, signedMessage, signature, '');
  return {
    verified,
    details: verified
      ? `Verification succeeded.\nFile hash: ${computedHash}\nSigner: ${identity.fingerprint}`
      : 'Signature verification failed.',
    signedMessage,
  };
}

export async function exportPublicIdentity(identityName: string): Promise<ExternalIdentity> {
  const raw = await readIdentityRaw(identityName);
  const publicData = Identity.readPublicData(raw);
  if (!publicData) {
    throw new Error('Unable to read public identity');
  }
  return {
    fingerprint: publicData.fingerprint,
    signingKeyType: publicData.signingKeyType,
    encryptionKeyType: publicData.encryptionKeyType,
    signingKey: publicData.signingKey,
    encryptionKey: publicData.encryptionKey,
    signingKeyDetails: publicData.signingKeyDetails,
    encryptionKeyDetails: publicData.encryptionKeyDetails,
    details: publicData.details,
    revoked: Boolean(publicData.revocationCertificate),
    revokedDetails: Object.keys(publicData.revokedDetails ?? {}),
  };
}
