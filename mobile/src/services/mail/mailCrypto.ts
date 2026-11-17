import {
  Identity,
  armorPayload,
  buildEncryptedSignedMessageMultiPayload,
  buildEncryptedSignedMessagePayload,
  buildEncryptedMessagePayload,
} from '../../ebpCore';
import {includeSenderAmongRecipients} from '../../../../common/SentMailbox';
import {publicIdentityBlock} from '../encryptDecryptLogic';
import type {ExternalIdentity} from '../../ebpCore';

export function encryptMailBody(
  identity: Identity,
  loaded: ExternalIdentity[],
  message: string,
  sign = true,
  includePublicKeys = true,
) {
  const encryptFor = sign
    ? includeSenderAmongRecipients(loaded, identity.summary)
    : loaded;

  let armor: string;
  if (encryptFor.length === 1 && sign) {
    const contact = encryptFor[0];
    const ciphertext = identity.signAndEncryptFor(message, contact);
    const payload = buildEncryptedSignedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      senderFingerprint: identity.toFingerprint(),
      ciphertext,
      senderIdentity: includePublicKeys
        ? publicIdentityBlock(identity)
        : undefined,
    });
    armor = armorPayload(payload);
  } else if (encryptFor.length === 1) {
    const contact = encryptFor[0];
    const ciphertext = Identity.EncryptFor(contact, message);
    const payload = buildEncryptedMessagePayload({
      recipientFingerprint: contact.fingerprint,
      ciphertext,
    });
    armor = armorPayload(payload);
  } else {
    if (!sign) {
      throw new Error('Multi-recipient EBP mail requires signing');
    }
    const encrypted = identity.signAndEncryptForMany(message, encryptFor);
    const payload = buildEncryptedSignedMessageMultiPayload({
      senderFingerprint: identity.toFingerprint(),
      recipients: encrypted.recipients,
      contentNonce: encrypted.contentNonce,
      ciphertext: encrypted.ciphertext,
      senderIdentity: includePublicKeys
        ? publicIdentityBlock(identity)
        : undefined,
    });
    armor = armorPayload(payload);
  }

  return {
    armor,
    fingerprint: identity.toFingerprint(),
    shortFingerprint: identity.toShortFingerprint(),
  };
}
