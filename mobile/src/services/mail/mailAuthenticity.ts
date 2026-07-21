import {sha256Hex} from '../../../../core/MessageHash.ts';
import type {ExternalIdentity} from '../../ebpCore';

export type MailVerifyStatus =
  | 'unsigned'
  | 'valid'
  | 'valid_unbound'
  | 'valid_unknown_signer'
  | 'invalid';

export type AuthenticityBadgeKind = 'good' | 'caution' | 'bad' | 'neutral';

export type MailAuthenticitySummary = {
  plaintext: string;
  verified: boolean | null;
  verifyStatus: MailVerifyStatus;
  signerFingerprint: string | null;
  contactName: string | null;
  isKnownContact: boolean;
  signerEmail: string | null;
  opaqueEmailMatched: boolean;
  matchedEmailPath: 'email' | 'opaque::email' | null;
  signerEmailVerified: boolean | null;
  signerMatchesSenderEmail: boolean | null;
  serverIdentityMatch: boolean | null;
  messageFrom: string;
};

function getDetailValue(
  details: ExternalIdentity['details'] | undefined,
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

export function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle?.[1] ?? trimmed).trim();
}

export function normalizeEmail(value: string): string {
  return extractEmailAddress(value).toLowerCase();
}

export function getDetailMeta(
  detailsMeta: ExternalIdentity['detailsMeta'] | undefined,
  path: string,
): {verified: boolean; verifiedAt: number | null} | null {
  if (!detailsMeta || typeof detailsMeta !== 'object') {
    return null;
  }
  const raw = detailsMeta[path];
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  return {
    verified: Boolean(raw.verified),
    verifiedAt:
      typeof raw.verifiedAt === 'number' ? raw.verifiedAt : null,
  };
}

/** Which published email claim (if any) matches the message From header. */
export function matchFromToIdentity(
  contact: ExternalIdentity,
  messageFrom: string,
): {
  matches: boolean | null;
  matchedPath: 'email' | 'opaque::email' | null;
  signerEmail: string | null;
  opaqueEmailMatched: boolean;
} {
  const fromRaw = extractEmailAddress(messageFrom);
  const fromNorm = fromRaw.toLowerCase();
  if (!fromNorm) {
    return {
      matches: null,
      matchedPath: null,
      signerEmail: getDetailValue(contact.details, 'email'),
      opaqueEmailMatched: false,
    };
  }

  const clearEmail = getDetailValue(contact.details, 'email');
  if (clearEmail && clearEmail.trim().toLowerCase() === fromNorm) {
    return {
      matches: true,
      matchedPath: 'email',
      signerEmail: clearEmail,
      opaqueEmailMatched: false,
    };
  }

  const resolved = contact.resolvedOpaqueDetails?.['opaque::email'];
  if (resolved && resolved.trim().toLowerCase() === fromNorm) {
    return {
      matches: true,
      matchedPath: 'opaque::email',
      signerEmail: resolved,
      opaqueEmailMatched: true,
    };
  }

  const opaqueHash = getDetailValue(contact.details, 'opaque::email');
  if (
    opaqueHash &&
    (sha256Hex(fromRaw) === opaqueHash || sha256Hex(fromNorm) === opaqueHash)
  ) {
    return {
      matches: true,
      matchedPath: 'opaque::email',
      signerEmail: resolved ?? fromRaw,
      opaqueEmailMatched: true,
    };
  }

  const hasClaim = Boolean(clearEmail || opaqueHash || resolved);
  return {
    matches: hasClaim ? false : null,
    matchedPath: null,
    signerEmail: clearEmail,
    opaqueEmailMatched: false,
  };
}

export function deriveBadgeKind(
  summary: Pick<
    MailAuthenticitySummary,
    | 'verifyStatus'
    | 'verified'
    | 'signerMatchesSenderEmail'
    | 'signerEmailVerified'
  >,
): AuthenticityBadgeKind {
  if (summary.verifyStatus === 'unsigned' || summary.verified === null) {
    return 'neutral';
  }
  if (summary.verifyStatus === 'invalid' || summary.verified === false) {
    return 'bad';
  }
  // Signature valid (possibly unknown signer / unbound)
  if (summary.signerMatchesSenderEmail === false) {
    return 'caution';
  }
  if (summary.signerEmailVerified === false) {
    return 'caution';
  }
  return 'good';
}

export function badgeLabel(kind: AuthenticityBadgeKind): string {
  switch (kind) {
    case 'good':
      return '✓';
    case 'caution':
      return '!';
    case 'bad':
      return '✗';
    default:
      return '○';
  }
}
