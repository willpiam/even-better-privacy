// Sender-authenticity helpers for decrypted EBP mail, shared by the mobile
// app and the desktop GUI backend. Pure functions only.

import { sha256Hex } from "./MessageHash.ts";

export type MailVerifyStatus =
  | "unsigned"
  | "valid"
  | "valid_unbound"
  | "valid_unknown_signer"
  | "invalid";

export type AuthenticityBadgeKind = "good" | "caution" | "bad" | "neutral";

export type MatchedEmailPath = "email" | "opaque::email";

export type MailAuthenticitySummary = {
  plaintext: string;
  verified: boolean | null;
  verifyStatus: MailVerifyStatus;
  signerFingerprint: string | null;
  contactName: string | null;
  isKnownContact: boolean;
  signerEmail: string | null;
  opaqueEmailMatched: boolean;
  matchedEmailPath: MatchedEmailPath | null;
  signerEmailVerified: boolean | null;
  signerMatchesSenderEmail: boolean | null;
  serverIdentityMatch: boolean | null;
  messageFrom: string;
};

/** Structural subset of ExternalIdentity needed for From matching. */
export type AuthenticityContact = {
  details?: Record<string, unknown>;
  resolvedOpaqueDetails?: Record<string, string>;
  detailsMeta?: Record<string, unknown>;
};

function getDetailValue(
  details: AuthenticityContact["details"],
  path: string,
): string | null {
  if (!details) {
    return null;
  }
  const val = details[path];
  if (Array.isArray(val)) {
    return typeof val[0] === "string" && val[0] ? val[0] : null;
  }
  return typeof val === "string" ? val : null;
}

export function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle?.[1] ?? trimmed).trim();
}

export function normalizeEmail(value: string): string {
  return extractEmailAddress(value).toLowerCase();
}

export function getDetailMeta(
  detailsMeta: AuthenticityContact["detailsMeta"],
  path: string,
): { verified: boolean; verifiedAt: number | null } | null {
  if (!detailsMeta || typeof detailsMeta !== "object") {
    return null;
  }
  const raw = detailsMeta[path] as
    | { verified?: unknown; verifiedAt?: unknown }
    | undefined;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    verified: Boolean(raw.verified),
    verifiedAt: typeof raw.verifiedAt === "number" ? raw.verifiedAt : null,
  };
}

/** Which published email claim (if any) matches the message From header. */
export function matchFromToIdentity(
  contact: AuthenticityContact,
  messageFrom: string,
): {
  matches: boolean | null;
  matchedPath: MatchedEmailPath | null;
  signerEmail: string | null;
  opaqueEmailMatched: boolean;
} {
  const fromRaw = extractEmailAddress(messageFrom);
  const fromNorm = fromRaw.toLowerCase();
  if (!fromNorm) {
    return {
      matches: null,
      matchedPath: null,
      signerEmail: getDetailValue(contact.details, "email"),
      opaqueEmailMatched: false,
    };
  }

  const clearEmail = getDetailValue(contact.details, "email");
  if (clearEmail && clearEmail.trim().toLowerCase() === fromNorm) {
    return {
      matches: true,
      matchedPath: "email",
      signerEmail: clearEmail,
      opaqueEmailMatched: false,
    };
  }

  const resolved = contact.resolvedOpaqueDetails?.["opaque::email"];
  if (resolved && resolved.trim().toLowerCase() === fromNorm) {
    return {
      matches: true,
      matchedPath: "opaque::email",
      signerEmail: resolved,
      opaqueEmailMatched: true,
    };
  }

  const opaqueHash = getDetailValue(contact.details, "opaque::email");
  if (
    opaqueHash &&
    (sha256Hex(fromRaw) === opaqueHash || sha256Hex(fromNorm) === opaqueHash)
  ) {
    return {
      matches: true,
      matchedPath: "opaque::email",
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

/**
 * From-header comparison plus the verification flag of the matching claim.
 * When the signer has a claim that does not match From, signerEmailVerified
 * reflects whether any of its email claims are verified.
 */
export function resolveSignerEmailClaim(
  contact: AuthenticityContact,
  messageFrom: string,
): {
  signerEmail: string | null;
  opaqueEmailMatched: boolean;
  matchedEmailPath: MatchedEmailPath | null;
  signerMatchesSenderEmail: boolean | null;
  signerEmailVerified: boolean | null;
} {
  const match = matchFromToIdentity(contact, messageFrom);
  let signerEmailVerified: boolean | null = null;
  if (match.matchedPath) {
    const meta = getDetailMeta(contact.detailsMeta, match.matchedPath);
    signerEmailVerified = meta ? meta.verified : false;
  } else if (
    getDetailValue(contact.details, "email") ||
    getDetailValue(contact.details, "opaque::email")
  ) {
    const emailMeta = getDetailMeta(contact.detailsMeta, "email");
    const opaqueMeta = getDetailMeta(contact.detailsMeta, "opaque::email");
    if (emailMeta || opaqueMeta) {
      signerEmailVerified = Boolean(
        emailMeta?.verified || opaqueMeta?.verified,
      );
    }
  }
  return {
    signerEmail: match.signerEmail,
    opaqueEmailMatched: match.opaqueEmailMatched,
    matchedEmailPath: match.matchedPath,
    signerMatchesSenderEmail: match.matches,
    signerEmailVerified,
  };
}

/**
 * When crypto verified but signer is not a known contact, elevate verify status.
 */
export function elevateUnknownSignerVerifyStatus(
  verified: boolean | null,
  isKnownContact: boolean,
  verifyStatus: string,
): string {
  if (verified === true && !isKnownContact) {
    if (verifyStatus === "valid" || verifyStatus === "valid_unbound") {
      return "valid_unknown_signer";
    }
  }
  return verifyStatus;
}

export function deriveBadgeKind(summary: {
  verifyStatus: string;
  verified: boolean | null;
  signerMatchesSenderEmail: boolean | null;
  signerEmailVerified: boolean | null;
}): AuthenticityBadgeKind {
  if (summary.verifyStatus === "unsigned" || summary.verified === null) {
    return "neutral";
  }
  if (summary.verifyStatus === "invalid" || summary.verified === false) {
    return "bad";
  }
  // Signature valid (possibly unknown signer / unbound)
  if (summary.signerMatchesSenderEmail === false) {
    return "caution";
  }
  if (summary.signerEmailVerified === false) {
    return "caution";
  }
  return "good";
}

export function badgeLabel(kind: AuthenticityBadgeKind): string {
  switch (kind) {
    case "good":
      return "✓";
    case "caution":
      return "!";
    case "bad":
      return "✗";
    default:
      return "○";
  }
}

export type MailAuthenticityFields = {
  signerEmail: string | null;
  signerEmailVerified: boolean | null;
  signerMatchesSenderEmail: boolean | null;
  matchedEmailPath: MatchedEmailPath | null;
  opaqueEmailMatched: boolean;
  isKnownContact: boolean;
  contactName: string | null;
  messageFrom: string;
  badgeKind: AuthenticityBadgeKind;
  badgeLabel: string;
};

/**
 * Authenticity fields for a decrypt response. Values derived from the signer's
 * published claims win; `fallback` fills in anything the claims cannot answer
 * (e.g. an embedded identity with no details).
 */
export function buildMailAuthenticityFields(params: {
  verified: boolean | null;
  verifyStatus: string;
  contact?: AuthenticityContact | null;
  messageFrom?: string | null;
  isKnownContact?: boolean;
  contactName?: string | null;
  fallback?: {
    signerEmail?: string | null;
    signerEmailVerified?: boolean | null;
    signerMatchesSenderEmail?: boolean | null;
  };
}): MailAuthenticityFields {
  const messageFrom = params.messageFrom ?? "";
  const fallback = params.fallback ?? {};
  const claim = params.contact
    ? resolveSignerEmailClaim(params.contact, messageFrom)
    : null;
  const signerEmail = claim?.signerEmail ?? fallback.signerEmail ?? null;
  const signerMatchesSenderEmail = claim?.signerMatchesSenderEmail ??
    fallback.signerMatchesSenderEmail ?? null;
  const signerEmailVerified = claim?.signerEmailVerified ??
    fallback.signerEmailVerified ?? null;
  const kind = deriveBadgeKind({
    verifyStatus: params.verifyStatus,
    verified: params.verified,
    signerMatchesSenderEmail,
    signerEmailVerified,
  });
  return {
    signerEmail,
    signerEmailVerified,
    signerMatchesSenderEmail,
    matchedEmailPath: claim?.matchedEmailPath ?? null,
    opaqueEmailMatched: claim?.opaqueEmailMatched ?? false,
    isKnownContact: Boolean(params.isKnownContact),
    contactName: params.contactName ?? null,
    messageFrom,
    badgeKind: kind,
    badgeLabel: badgeLabel(kind),
  };
}
