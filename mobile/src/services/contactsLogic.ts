/**
 * Pure contact helpers (Deno/Jest-testable; no RNFS / network).
 */
import type {ExternalIdentity} from '../../../core/ExternalIdentity.ts';
import {sha256Hex} from '../../../core/MessageHash.ts';

export function getDetailValue(
  details: Record<string, [string, string]> | undefined,
  path: string,
): string | null {
  if (!details) {
    return null;
  }
  const val = details[path];
  if (Array.isArray(val)) {
    return val[0] || null;
  }
  return typeof val === 'string' ? val : null;
}

export function normalizeContactName(name: string): string {
  const value = name.trim();
  if (!value) {
    throw new Error('Contact name is required');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      'Contact name must use only letters, numbers, dash, underscore',
    );
  }
  return value;
}

/** Cleartext compare helper (trim + lowercase). */
export function emailsEqualIgnoreCase(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Strip revoked detail paths from details / detailsMeta maps.
 */
export function stripRevokedDetails<
  D extends Record<string, unknown>,
  M extends Record<string, unknown>,
>(
  details: D,
  detailsMeta: M,
  revokedDetails: string[],
): {details: D; detailsMeta: M} {
  const nextDetails = {...details};
  const nextMeta = {...detailsMeta};
  for (const path of revokedDetails) {
    delete nextDetails[path];
    delete nextMeta[path];
  }
  return {details: nextDetails, detailsMeta: nextMeta};
}

export function normalizeExternalIdentity(
  source: Record<string, unknown>,
  fallbackFingerprint?: string,
): ExternalIdentity {
  const signingKeyType =
    source.signingKeyType === 'sphincs' ? 'sphincs' : 'dilithium';
  const fingerprint =
    typeof source.fingerprint === 'string' && source.fingerprint
      ? source.fingerprint
      : fallbackFingerprint ?? '';
  const signingKey =
    typeof source.signingKey === 'string' ? source.signingKey : '';
  const encryptionKey =
    typeof source.encryptionKey === 'string' ? source.encryptionKey : '';
  if (!fingerprint || !signingKey || !encryptionKey) {
    throw new Error('Invalid public identity payload');
  }
  const revokedDetails = Array.isArray(source.revokedDetails)
    ? (source.revokedDetails as string[])
    : [];

  const stripped = stripRevokedDetails(
    {...((source.details as ExternalIdentity['details']) ?? {})},
    {...((source.detailsMeta as ExternalIdentity['detailsMeta']) ?? {})},
    revokedDetails,
  );

  return {
    fingerprint,
    signingKeyType,
    encryptionKeyType: 'kyber',
    signingKey,
    encryptionKey,
    signingKeyDetails:
      (source.signingKeyDetails as ExternalIdentity['signingKeyDetails']) ?? {
        variant: 'ml_dsa87',
      },
    encryptionKeyDetails:
      (source.encryptionKeyDetails as ExternalIdentity['encryptionKeyDetails']) ??
      {
        variant: 'ml_kem1024',
      },
    details: stripped.details,
    detailsMeta: stripped.detailsMeta,
    revoked: Boolean(source.revoked),
    revokedDetails,
  };
}

/**
 * Soft normalize for server/embedded sender payloads (empty keys allowed).
 */
export function normalizeServerIdentity(
  body: Record<string, unknown>,
  fallbackFingerprint: string,
): ExternalIdentity {
  const signingKeyType =
    body.signingKeyType === 'sphincs' ? 'sphincs' : 'dilithium';
  const fingerprint =
    typeof body.fingerprint === 'string' && body.fingerprint
      ? body.fingerprint
      : fallbackFingerprint;
  const revokedDetails = Array.isArray(body.revokedDetails)
    ? (body.revokedDetails as string[])
    : [];
  const stripped = stripRevokedDetails(
    {...((body.details as ExternalIdentity['details']) ?? {})},
    {...((body.detailsMeta as ExternalIdentity['detailsMeta']) ?? {})},
    revokedDetails,
  );
  return {
    fingerprint,
    signingKeyType,
    encryptionKeyType: 'kyber',
    signingKey: String(body.signingKey ?? ''),
    encryptionKey: String(body.encryptionKey ?? ''),
    signingKeyDetails:
      (body.signingKeyDetails as ExternalIdentity['signingKeyDetails']) ?? {
        variant: 'ml_dsa87',
      },
    encryptionKeyDetails:
      (body.encryptionKeyDetails as ExternalIdentity['encryptionKeyDetails']) ??
      {variant: 'ml_kem1024'},
    details: stripped.details,
    detailsMeta: stripped.detailsMeta,
    revoked: Boolean(body.revoked),
    revokedDetails,
  };
}

/**
 * Match a typed address against published `email` detail or `opaque::email`
 * (resolved cleartext or SHA-256 hash of the trimmed typed value).
 */
export function contactMatchesEmail(
  contact: ExternalIdentity,
  trimmedEmail: string,
  normalizedEmail: string,
): boolean {
  const detailEmail = getDetailValue(contact.details, 'email');
  if (detailEmail && emailsEqualIgnoreCase(detailEmail, normalizedEmail)) {
    return true;
  }
  const resolved = contact.resolvedOpaqueDetails?.['opaque::email'];
  if (resolved && emailsEqualIgnoreCase(resolved, normalizedEmail)) {
    return true;
  }
  const opaqueHash = getDetailValue(contact.details, 'opaque::email');
  if (opaqueHash && sha256Hex(trimmedEmail) === opaqueHash) {
    return true;
  }
  return false;
}

export function apiUrl(server: string, path: string): string {
  const base = server.replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
