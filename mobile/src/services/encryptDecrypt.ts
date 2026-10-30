import RNFS from 'react-native-fs';
import {
  Identity,
  base64ToBytes,
  bytesToBase64,
  buildEncryptedFilePayload,
  buildEncryptedSignedFilePayload,
  createFileCleartextEnvelope,
  parseFileCleartextEnvelope,
  parseMultiRecipientEntries,
} from '../ebpCore';
import {loadContact} from './contacts';
import {loadIdentityForUse} from './storage';
import {resolveSenderForDecrypt} from './senderContext';
import {
  decryptMessageWithIdentity,
  encryptMessageWithIdentity,
  isEncryptedFileType,
  isEncryptedMessageType,
  isEncryptedSignedFileType,
  isEncryptedSignedMessageMultiType,
  isEncryptedSignedMessageType,
  normalizeFileUri,
  requireCiphertext,
  senderFieldsFromPayload,
} from './encryptDecryptLogic';

export {
  normalizeFileUri,
  publicIdentityBlock,
  requireCiphertext,
  senderFieldsFromPayload,
} from './encryptDecryptLogic';

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
  let identity: Identity | undefined;
  if (params.sign) {
    identity = await loadIdentityForUse(params.identityName, params.password);
  }
  return encryptMessageWithIdentity({
    message: params.message,
    recipient: contact,
    identity,
    sign: params.sign,
  });
}

export async function decryptMessage(params: {
  identityName: string;
  password?: string;
  payload: Record<string, unknown>;
  sender?: string;
}): Promise<{
  message: string;
  verified: boolean | null;
  verifyStatus: 'unsigned' | 'valid' | 'valid_unbound' | 'invalid';
  isKnownContact: boolean;
  signerFingerprint: string | null;
  contact: import('../ebpCore').ExternalIdentity | null;
}> {
  const identity = await loadIdentityForUse(params.identityName, params.password);
  const type = params.payload.type;
  const ciphertext = requireCiphertext(params.payload);
  if (isEncryptedMessageType(type)) {
    const result = decryptMessageWithIdentity({identity, payload: params.payload});
    return {
      message: result.message,
      verified: null,
      verifyStatus: 'unsigned',
      isKnownContact: false,
      signerFingerprint: null,
      contact: null,
    };
  }
  if (isEncryptedSignedMessageMultiType(type)) {
    const contentNonce = String(params.payload.contentNonce ?? '');
    const recipients = parseMultiRecipientEntries(params.payload.recipients);
    if (!contentNonce || recipients.length === 0) {
      throw new Error('Invalid multi-recipient payload');
    }
    const {senderFingerprint: senderFp, embeddedIdentity: embedded} =
      senderFieldsFromPayload(params.payload);
    const {contact, isKnownContact} = await resolveSenderForDecrypt({
      senderHint: params.sender,
      senderFingerprint: senderFp,
      embeddedIdentity: embedded,
    });
    const result = identity.decryptAndVerifyMulti(
      {recipients, contentNonce, ciphertext},
      contact,
    );
    return {
      message: result.message,
      verified: result.verified,
      verifyStatus: result.verifyStatus,
      isKnownContact,
      signerFingerprint: contact.fingerprint ?? senderFp ?? null,
      contact,
    };
  }
  if (isEncryptedSignedMessageType(type)) {
    const {senderFingerprint: senderFp, embeddedIdentity: embedded} =
      senderFieldsFromPayload(params.payload);
    const {contact, isKnownContact} = await resolveSenderForDecrypt({
      senderHint: params.sender,
      senderFingerprint: senderFp,
      embeddedIdentity: embedded,
    });
    const result = decryptMessageWithIdentity({
      identity,
      payload: params.payload,
      sender: contact,
    });
    return {
      message: result.message,
      verified: result.verified,
      verifyStatus: result.verifyStatus,
      isKnownContact,
      signerFingerprint: contact.fingerprint ?? senderFp ?? null,
      contact,
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
    const identity = await loadIdentityForUse(params.identityName, params.password);
    const ciphertext = identity.signAndEncryptFor(cleartext, recipient);
    return buildEncryptedSignedFilePayload({
      recipientFingerprint: recipient.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      fileName: envelope.fileName,
      mimeType: envelope.mimeType,
      fileSize: envelope.fileSize,
      ciphertext,
    }) as Record<string, unknown>;
  }
  const ciphertext = Identity.EncryptFor(recipient, cleartext);
  return buildEncryptedFilePayload({
    recipientFingerprint: recipient.fingerprint,
    fileName: envelope.fileName,
    mimeType: envelope.mimeType,
    fileSize: envelope.fileSize,
    ciphertext,
  }) as Record<string, unknown>;
}

export async function decryptFile(params: {
  identityName: string;
  password?: string;
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
  const identity = await loadIdentityForUse(params.identityName, params.password);
  const type = params.payload.type;
  const ciphertext = requireCiphertext(params.payload);
  let cleartext = '';
  let verified: boolean | null = null;
  let verifyStatus: 'unsigned' | 'valid' | 'invalid' = 'unsigned';
  if (isEncryptedFileType(type)) {
    cleartext = identity.encryptionKey.decrypt(ciphertext);
  } else if (isEncryptedSignedFileType(type)) {
    const {senderFingerprint: senderFp, embeddedIdentity: embedded} =
      senderFieldsFromPayload(params.payload);
    const {contact} = await resolveSenderForDecrypt({
      senderHint: params.sender,
      senderFingerprint: senderFp,
      embeddedIdentity: embedded,
    });
    const result = identity.decryptAndVerify(ciphertext, contact);
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
