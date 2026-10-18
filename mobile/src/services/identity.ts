import {Identity, validatePassword} from '../ebpCore';
import type {SigningType, StoredIdentityMeta} from '../types';
import {getEnforcePasswordPolicy} from './settings';
import {persistIdentity} from './storage';

/** Prefix path with opaque:: when the toggle is on (GUI detail-opaque guard). */
export function resolveOpaqueDetailPath(
  path: string,
  opaque: boolean,
): string {
  const trimmed = path.trim();
  if (opaque && !trimmed.startsWith('opaque::')) {
    return `opaque::${trimmed}`;
  }
  return trimmed;
}

/**
 * Keep at least one public key selected for export (GUI enforceExportKeySelection).
 * When both would be off, re-enable the key that was not just turned off.
 */
export function enforceAtLeastOneExportKey(
  includeSigningKey: boolean,
  includeEncryptionKey: boolean,
  changed: 'signing' | 'encryption',
): {includeSigningKey: boolean; includeEncryptionKey: boolean} {
  if (includeSigningKey || includeEncryptionKey) {
    return {includeSigningKey, includeEncryptionKey};
  }
  if (changed === 'signing') {
    return {includeSigningKey: false, includeEncryptionKey: true};
  }
  return {includeSigningKey: true, includeEncryptionKey: false};
}

export async function createRandomIdentity(params: {
  name: string;
  password: string;
  signingType: SigningType;
  overwrite?: boolean;
}): Promise<StoredIdentityMeta> {
  if (!['dilithium', 'sphincs'].includes(params.signingType)) {
    throw new Error(
      `Invalid signing key type: ${params.signingType}. Use 'dilithium' or 'sphincs'.`,
    );
  }
  const enforce = await getEnforcePasswordPolicy();
  const passwordCheck = validatePassword(params.password, {
    enforcePolicy: enforce,
  });
  if (!passwordCheck.ok) {
    throw new Error(passwordCheck.reason);
  }

  const identity = new Identity(params.signingType, 'kyber');
  return persistIdentity({
    name: params.name,
    password: params.password,
    identity,
    overwrite: params.overwrite,
  });
}
