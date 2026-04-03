import RNFS from 'react-native-fs';
import {
  Identity,
  base64ToBytes,
  bytesToBase64,
  createFileCleartextEnvelope,
  parseFileCleartextEnvelope,
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
} from '../ebpCore';
import {loadContact} from './contacts';
import {loadIdentity} from './storage';

function normalizeFileUri(uri: string): string {
  return uri.startsWith('file://') ? uri.replace('file://', '') : uri;
}

export async function encryptMessage(params: {
  identityName: string;
  password?: string;
  message: string;
  recipient: string;
  sign?: boolean;
}): Promise<Record<string, unknown>> {
  if (!params.message) {
    throw new Error('Message is required');
  }
  if (!params.recipient) {
    throw new Error('Recipient is required');
  }
  const contact = await loadContact(params.recipient);
  if (params.sign) {
    if (!params.password) {
      throw new Error('Password is required when signing');
    }
    const identity = await loadIdentity(params.identityName, params.password);
    const ciphertext = identity.signAndEncryptFor(params.message, contact);
    return buildEncryptedSignedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      ciphertext,
    }) as Record<string, unknown>;
  }
  const ciphertext = Identity.EncryptFor(contact, params.message);
  return buildEncryptedMessagePayload({
    recipientFingerprint: contact.fingerprint,
    ciphertext,
  }) as Record<string, unknown>;
}

export async function decryptMessage(params: {
  identityName: string;
  password: string;
  payload: Record<string, unknown>;
  sender?: string;
}): Promise<{
  message: string;
  verified: boolean | null;
  verifyStatus: 'unsigned' | 'valid' | 'invalid';
}> {
  const identity = await loadIdentity(params.identityName, params.password);
  const type = params.payload.type;
  const ciphertext = String(params.payload.ciphertext ?? '');
  if (!ciphertext) {
    throw new Error('Payload missing ciphertext');
  }
  if (type === 'ebp-encrypted-message') {
    return {
      message: identity.encryptionKey.decrypt(ciphertext),
      verified: null,
      verifyStatus: 'unsigned',
    };
  }
  if (type === 'ebp-encrypted-signed-message') {
    const senderHint =
      params.sender ??
      (typeof params.payload.senderFingerprint === 'string'
        ? params.payload.senderFingerprint.slice(0, 16)
        : '');
    if (!senderHint) {
      throw new Error('Sender is required for signed messages');
    }
    const sender = await loadContact(senderHint);
    const result = identity.decryptAndVerify(ciphertext, sender);
    return {
      message: result.message,
      verified: result.verified,
      verifyStatus: result.verified ? 'valid' : 'invalid',
    };
  }
  throw new Error('Unsupported payload type');
}

export async function encryptFile(params: {
  identityName: string;
  password?: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
  recipient: string;
  sign?: boolean;
}): Promise<Record<string, unknown>> {
  const recipient = await loadContact(params.recipient);
  const path = normalizeFileUri(params.fileUri);
  const base64 = await RNFS.readFile(path, 'base64');
  const bytes = base64ToBytes(base64);
  const envelope = createFileCleartextEnvelope(
    bytes,
    params.fileName,
    params.mimeType ?? 'application/octet-stream',
  );
  const cleartext = JSON.stringify(envelope);
  if (params.sign) {
    if (!params.password) {
      throw new Error('Password is required when signing');
    }
    const identity = await loadIdentity(params.identityName, params.password);
    const ciphertext = identity.signAndEncryptFor(cleartext, recipient);
    return {
      type: 'ebp-encrypted-signed-file',
      recipientFingerprint: recipient.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      fileName: envelope.fileName,
      mimeType: envelope.mimeType,
      fileSize: envelope.fileSize,
      ciphertext,
    };
  }
  const ciphertext = Identity.EncryptFor(recipient, cleartext);
  return {
    type: 'ebp-encrypted-file',
    recipientFingerprint: recipient.fingerprint,
    fileName: envelope.fileName,
    mimeType: envelope.mimeType,
    fileSize: envelope.fileSize,
    ciphertext,
  };
}

export async function decryptFile(params: {
  identityName: string;
  password: string;
  payload: Record<string, unknown>;
  sender?: string;
}): Promise<{
  fileName: string;
  mimeType: string;
  fileSize: number;
  fileDataBase64: string;
  verified: boolean | null;
  verifyStatus: 'unsigned' | 'valid' | 'invalid';
}> {
  const identity = await loadIdentity(params.identityName, params.password);
  const type = params.payload.type;
  const ciphertext = String(params.payload.ciphertext ?? '');
  if (!ciphertext) {
    throw new Error('Payload missing ciphertext');
  }
  let cleartext = '';
  let verified: boolean | null = null;
  let verifyStatus: 'unsigned' | 'valid' | 'invalid' = 'unsigned';
  if (type === 'ebp-encrypted-file') {
    cleartext = identity.encryptionKey.decrypt(ciphertext);
  } else if (type === 'ebp-encrypted-signed-file') {
    const senderHint =
      params.sender ??
      (typeof params.payload.senderFingerprint === 'string'
        ? params.payload.senderFingerprint.slice(0, 16)
        : '');
    if (!senderHint) {
      throw new Error('Sender is required for signed file payloads');
    }
    const sender = await loadContact(senderHint);
    const result = identity.decryptAndVerify(ciphertext, sender);
    cleartext = result.message;
    verified = result.verified;
    verifyStatus = result.verified ? 'valid' : 'invalid';
  } else {
    throw new Error('Unsupported payload type');
  }

  const envelope = parseFileCleartextEnvelope(cleartext);
  return {
    fileName: envelope.fileName,
    mimeType: envelope.mimeType,
    fileSize: envelope.fileSize,
    fileDataBase64: bytesToBase64(envelope.fileBytes),
    verified,
    verifyStatus,
  };
}
