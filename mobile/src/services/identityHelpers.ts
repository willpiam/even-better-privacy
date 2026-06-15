import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {computeExternalFingerprint} from '../../../core/Fingerprint.ts';

export function fingerprintFromPublicIdentity(
  publicIdentity: Record<string, unknown>,
): string {
  const signingKey =
    typeof publicIdentity.signingKey === 'string' ? publicIdentity.signingKey : '';
  const signingKeyHash =
    typeof publicIdentity.signingKeyHash === 'string'
      ? publicIdentity.signingKeyHash
      : '';
  const signingKeyType =
    typeof publicIdentity.signingKeyType === 'string'
      ? publicIdentity.signingKeyType
      : '';
  const encryptionKey =
    typeof publicIdentity.encryptionKey === 'string'
      ? publicIdentity.encryptionKey
      : '';
  const encryptionKeyHash =
    typeof publicIdentity.encryptionKeyHash === 'string'
      ? publicIdentity.encryptionKeyHash
      : '';
  const encryptionKeyType =
    typeof publicIdentity.encryptionKeyType === 'string'
      ? publicIdentity.encryptionKeyType
      : '';
  if ((!signingKey && !signingKeyHash) || !signingKeyType) {
    throw new Error('public identity missing signing key or hash');
  }
  if ((!encryptionKey && !encryptionKeyHash) || encryptionKeyType !== 'kyber') {
    throw new Error('public identity missing encryption key or hash');
  }
  if (!['dilithium', 'sphincs'].includes(signingKeyType)) {
    throw new Error('invalid signing key type');
  }
  const external: ExternalIdentity = {
    fingerprint:
      typeof publicIdentity.fingerprint === 'string'
        ? publicIdentity.fingerprint
        : '',
    signingKey,
    signingKeyHash: signingKeyHash || undefined,
    signingKeyType: signingKeyType as ExternalIdentity['signingKeyType'],
    signingKeyDetails:
      (publicIdentity.signingKeyDetails as ExternalIdentity['signingKeyDetails']) ??
      {variant: 'ml_dsa87'},
    encryptionKey,
    encryptionKeyHash: encryptionKeyHash || undefined,
    encryptionKeyType: 'kyber',
    encryptionKeyDetails:
      (publicIdentity.encryptionKeyDetails as ExternalIdentity['encryptionKeyDetails']) ??
      {variant: 'ml_kem1024'},
    details: (publicIdentity.details as ExternalIdentity['details']) ?? {},
  };
  const computed = computeExternalFingerprint(external);
  if (!computed) {
    throw new Error('could not compute fingerprint from public identity');
  }
  return computed;
}
