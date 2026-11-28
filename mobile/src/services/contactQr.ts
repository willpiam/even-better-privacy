import {isValidAddress} from '../../../common/ComposeRecipients.ts';
import {base64ToBytes, bytesToBase64} from '../../../core/Base64.ts';
import {externalIdentityFromEmbeddedRecord} from '../../../core/EmbeddedIdentity.ts';
import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {hexToBytes, toHex} from '../../../core/Hex.ts';
import type {IdentityPublicData} from '../../../core/Identity.ts';
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

export type ScannedContact = {
  identity: ExternalIdentity;
  name: string;
  email?: string;
};

const frameDataLength = 1000;
const maxFrames = 7;
export const contactQrNameLimit = 64;
const framePattern = new RegExp(
  `^EBP-CONTACT-([12]):([a-f0-9]{64}):([1-${maxFrames}])/([1-${maxFrames}]):([ -~]+)$`,
);

function validatePublicKeys(
  record: Record<string, unknown>,
  fingerprint: string,
): ExternalIdentity {
  const identity =
    fingerprint && externalIdentityFromEmbeddedRecord(record, fingerprint);
  if (!identity) {
    throw new Error('The public keys do not match the contact fingerprint.');
  }
  return identity;
}

function isShareableEmail(email: string): boolean {
  return (
    isValidAddress(email) &&
    new TextEncoder().encode(email).length <= 254 &&
    !/\p{Cc}/u.test(email)
  );
}

export function getContactQrEmail(
  identity: Pick<IdentityPublicData, 'details' | 'revokedDetails'>,
): string | undefined {
  const detail = identity.details?.email?.[0];
  const email = typeof detail === 'string' ? detail.trim() : undefined;
  if (email && !identity.revokedDetails?.email && isShareableEmail(email)) {
    return email;
  }
}

export function encodeContactQr(
  identity: PublicKeys,
  name: string,
  email?: string,
): string[] {
  const keys = validatePublicKeys(identity, identity.fingerprint);
  if (email !== undefined && !isShareableEmail(email)) {
    throw new Error('Invalid contact email address.');
  }
  const version = email === undefined ? '1' : '2';
  // Escape non-ASCII so camera decoders agree on the contents and digest.
  const payload = JSON.stringify([
    keys.fingerprint,
    keys.signingKeyType,
    keys.signingKeyDetails.variant,
    keys.encryptionKeyDetails.variant,
    keys.signingKey,
    bytesToBase64(hexToBytes(keys.encryptionKey)),
    name.slice(0, contactQrNameLimit),
    ...(email === undefined ? [] : [email]),
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
    return `EBP-CONTACT-${version}:${digest}:${index + 1}/${count}:${chunk}`;
  });
}

function decodePayload(payload: string, version: string): ScannedContact {
  const fields: unknown = JSON.parse(payload);
  if (
    !Array.isArray(fields) ||
    fields.length !== (version === '1' ? 7 : 8) ||
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
    email,
  ] = fields as string[];
  const encryptionKeyBytes = base64ToBytes(encodedEncryptionKey);
  if (
    name.length > contactQrNameLimit ||
    bytesToBase64(encryptionKeyBytes) !== encodedEncryptionKey
  ) {
    throw new Error('Invalid contact QR data.');
  }
  const identity = validatePublicKeys(
    {
      signingKeyType,
      signingKey,
      signingKeyDetails: {variant: signingVariant},
      encryptionKey: toHex(encryptionKeyBytes),
      encryptionKeyType: 'kyber',
      encryptionKeyDetails: {variant: encryptionVariant},
    },
    fingerprint,
  );
  if (email !== undefined && !isShareableEmail(email)) {
    throw new Error('Invalid contact email address.');
  }
  return {identity, name: name.trim(), ...(email === undefined ? {} : {email})};
}

/** Collects one contact at a time, allowing repeated and out-of-order frames. */
export class ContactQrScanner {
  private version?: string;
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
    const [, version, digest, position, count, chunk] = match;
    const index = Number(position);
    const total = Number(count);
    if (
      index > total ||
      chunk.length > frameDataLength ||
      (index < total && chunk.length !== frameDataLength)
    ) {
      throw new Error('Invalid contact QR frame.');
    }
    if (
      this.digest &&
      (this.version !== version ||
        this.digest !== digest ||
        this.total !== total)
    ) {
      throw new Error('This is a different contact code. Restart to scan it.');
    }
    const previous = this.chunks.get(index);
    if (previous !== undefined && previous !== chunk) {
      throw new Error('Contact QR frames conflict. Restart the scan.');
    }
    this.version = version;
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
    return {...progress, contact: decodePayload(payload, version)};
  }
}
