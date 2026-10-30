import RNFS from 'react-native-fs';
import {sha256} from '@noble/hashes/sha2';
import {
  Identity,
  toHex,
  base64ToBytes,
  buildFileSignMessage,
  type ExternalIdentity,
  type IdentityPublicExport,
  type IdentityPublicExportOptions,
  externalIdentityFromEmbeddedRecord,
} from '../ebpCore';
import {loadContact} from './contacts';
import {loadIdentityForUse} from './storage';
import {
  type SignMessageOptions,
  signMessageWithIdentity,
  signFileBytesWithIdentity,
} from './signVerifyLogic';

export type {SignMessageOptions};

function normalizeFileUri(uri: string): string {
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
}

export async function signMessage(params: {
  identityName: string;
  password?: string;
  message: string;
  options?: SignMessageOptions;
}): Promise<Record<string, unknown>> {
  const identity = await loadIdentityForUse(params.identityName, params.password);
  return signMessageWithIdentity(identity, params.message, params.options);
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
  if (toHex(sha256(new TextEncoder().encode(message))) !== messageHash) {
    throw new Error('Message hash mismatch');
  }
  const embedded =
    payload.identity && typeof payload.identity === 'object'
      ? externalIdentityFromEmbeddedRecord(
          payload.identity as Record<string, unknown>,
          fingerprint || undefined,
        )
      : null;
  const senderIdentity =
    params.publicIdentity ??
    embedded ??
    (await loadContact(params.sender ?? fingerprint.slice(0, 16)));
  const verified = Identity.VerifySignature(senderIdentity, message, signature, salt);
  return {verified};
}

export async function signFile(params: {
  identityName: string;
  password?: string;
  fileUri: string;
  fileName?: string;
  contextMessage?: string;
  includeSalt?: boolean;
}): Promise<{
  payload: Record<string, unknown>;
  fileHash: string;
  signedMessage: string;
  salt: string;
}> {
  const identity = await loadIdentityForUse(params.identityName, params.password);
  const path = normalizeFileUri(params.fileUri);
  const base64 = await RNFS.readFile(path, 'base64');
  const bytes = base64ToBytes(base64);
  return signFileBytesWithIdentity({
    identity,
    fileBytes: bytes,
    fileName: params.fileName ?? params.fileUri.split('/').pop() ?? 'file',
    contextMessage: params.contextMessage,
    includeSalt: params.includeSalt,
  });
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
  const signedMessage = buildFileSignMessage(computedHash, salt, contextMessage);
  const verified = Identity.VerifySignature(identity, signedMessage, signature, '');
  return {
    verified,
    details: verified
      ? `Verification succeeded.\nFile hash: ${computedHash}\nSigner: ${identity.fingerprint}`
      : 'Signature verification failed.',
    signedMessage,
  };
}

export async function exportPublicIdentity(
  identityName: string,
  password: string | undefined,
  options: IdentityPublicExportOptions = {},
): Promise<IdentityPublicExport> {
  const includeSigningKey = options.includeSigningKey ?? true;
  const includeEncryptionKey = options.includeEncryptionKey ?? true;
  if (!includeSigningKey && !includeEncryptionKey) {
    throw new Error('Public export must include at least one public key');
  }
  const identity = await loadIdentityForUse(identityName, password);
  return identity.toPublicExport({
    includeSigningKey,
    includeEncryptionKey,
    includeDetails: options.includeDetails ?? true,
  });
}
