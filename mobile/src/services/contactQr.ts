import {base64ToBytes, bytesToBase64} from '../../../core/Base64.ts';
import {externalIdentityFromEmbeddedRecord} from '../../../core/EmbeddedIdentity.ts';
import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {hexToBytes, toHex} from '../../../core/Hex.ts';
import {sha256Hex} from '../../../core/MessageHash.ts';

type PublicKeys = Pick<
  ExternalIdentity,
  | 'fingerprint'
  | 'signingKey'
  | 'signingKeyType'
  | 'signingKeyDetails'
  | 'encryptionKey'
  | 'encryptionKeyType'
  | 'encryptionKeyDetails'
>;

export type ScannedContact = {identity: ExternalIdentity; name: string};

const framePrefix = 'EBP-CONTACT-1';
const frameDataLength = 1000;
const maxFrames = 7;
export const contactQrNameLimit = 64;
const framePattern = new RegExp(
  `^${framePrefix}:([a-f0-9]{64}):([1-${maxFrames}])/([1-${maxFrames}]):([ -~]+)$`,
);

function validatePublicKeys(record: Record<string, unknown>): ExternalIdentity {
  const identity = externalIdentityFromEmbeddedRecord(record);
  if (!identity || identity.fingerprint !== record.fingerprint) {
    throw new Error('The public keys do not match the contact fingerprint.');
  }
  return identity;
}

export function encodeContactQr(identity: PublicKeys, name: string): string[] {
  const keys = validatePublicKeys(identity);
  // Only the specified public keys and display name are included in the code.
  // Escape non-ASCII so camera decoders agree on the contents and digest.
  const payload = JSON.stringify([
    keys.fingerprint,
    keys.signingKeyType,
    keys.signingKeyDetails.variant,
    keys.encryptionKeyDetails.variant,
    keys.signingKey,
    bytesToBase64(hexToBytes(keys.encryptionKey)),
    name.slice(0, contactQrNameLimit),
  ]).replace(
    /[\u007f-\uffff]/g,
    char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  const digest = sha256Hex(payload);
  const count = Math.ceil(payload.length / frameDataLength);
  if (count > maxFrames)
    throw new Error('The identity is too large to share by QR.');
  return Array.from({length: count}, (_, index) => {
    const start = index * frameDataLength;
    const chunk = payload.slice(start, start + frameDataLength);
    return `${framePrefix}:${digest}:${index + 1}/${count}:${chunk}`;
  });
}

function decodePayload(payload: string): ScannedContact {
  const fields: unknown = JSON.parse(payload);
  if (
    !Array.isArray(fields) ||
    fields.length !== 7 ||
    !fields.every(field => typeof field === 'string')
  ) {
    throw new Error('Invalid contact QR data.');
  }
  const [
    fingerprint,
    signingKeyType,
    signingVariant,
    encryptionVariant,
    signingKey,
    encodedEncryptionKey,
    name,
  ] = fields as string[];
  const encryptionKeyBytes = base64ToBytes(encodedEncryptionKey);
  if (
    name.length > contactQrNameLimit ||
    bytesToBase64(encryptionKeyBytes) !== encodedEncryptionKey
  ) {
    throw new Error('Invalid contact QR data.');
  }
  const identity = validatePublicKeys({
    fingerprint,
    signingKeyType,
    signingKey,
    signingKeyDetails: {variant: signingVariant},
    encryptionKey: toHex(encryptionKeyBytes),
    encryptionKeyType: 'kyber',
    encryptionKeyDetails: {variant: encryptionVariant},
  });
  return {identity, name: name.trim()};
}

/** Collects one contact at a time, allowing repeated and out-of-order frames. */
export class ContactQrScanner {
  private digest?: string;
  private total = 0;
  private readonly chunks = new Map<number, string>();

  add(value: string): {
    received: number;
    total: number;
    contact?: ScannedContact;
  } {
    const match =
      value.length <= frameDataLength + 90 && framePattern.exec(value);
    if (!match || match[0] !== value)
      throw new Error('Scan an EBP contact QR code.');
    const [, digest, position, count, chunk] = match;
    const index = Number(position);
    const total = Number(count);
    if (
      index > total ||
      chunk.length > frameDataLength ||
      (index < total && chunk.length !== frameDataLength)
    ) {
      throw new Error('Invalid contact QR frame.');
    }
    if (this.digest && (this.digest !== digest || this.total !== total)) {
      throw new Error('This is a different contact code. Restart to scan it.');
    }
    const previous = this.chunks.get(index);
    if (previous !== undefined && previous !== chunk) {
      throw new Error('Contact QR frames conflict. Restart the scan.');
    }
    this.digest = digest;
    this.total = total;
    this.chunks.set(index, chunk);
    const progress = {received: this.chunks.size, total};
    if (progress.received < total) return progress;

    const payload = Array.from({length: total}, (_, i) =>
      this.chunks.get(i + 1),
    ).join('');
    if (sha256Hex(payload) !== digest)
      throw new Error('Contact QR data is damaged. Restart the scan.');
    return {...progress, contact: decodePayload(payload)};
  }
}
