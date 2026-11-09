// Exact verified-email matching for compose autofill.
// Search results are substring hits, so callers must run them through this
// filter before treating a fingerprint as the recipient.

export const VERIFIED_EMAIL_SEARCH_PAGE_SIZE = 100;
export const VERIFIED_EMAIL_SEARCH_MAX_PAGES = 10;

export type EmailIdentityCandidate = {
  fingerprint?: string;
  revoked?: boolean;
  details?: Record<string, unknown>;
  detailsMeta?: Record<string, unknown>;
  revokedDetails?: string[];
};

export type VerifiedEmailMatch =
  | { status: "unique"; fingerprint: string }
  | { status: "none" }
  | { status: "ambiguous" };

export type VerifiedEmailPage = {
  identities: EmailIdentityCandidate[];
  hasNextPage: boolean;
};

export type LocalContactRef = {
  name: string;
  fingerprint: string;
};

export type RecipientResolution =
  | { action: "use"; name: string; source: "local" | "pinned" }
  | { action: "import"; fingerprint: string }
  | { action: "unresolved" };

function detailValue(
  details: Record<string, unknown> | undefined,
  path: string,
): string | null {
  if (!details) return null;
  const value = details[path];
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" && first.length > 0 ? first : null;
  }
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isVerified(
  detailsMeta: Record<string, unknown> | undefined,
  path: string,
): boolean {
  const entry = detailsMeta?.[path];
  if (!entry || typeof entry !== "object") return false;
  return (entry as { verified?: unknown }).verified === true;
}

export function matchVerifiedEmailIdentities(
  candidates: EmailIdentityCandidate[],
  email: string,
): VerifiedEmailMatch {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return { status: "none" };
  const fingerprints = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate.revoked) continue;
    const fingerprint = candidate.fingerprint?.trim() ?? "";
    if (!fingerprint) continue;
    if (candidate.revokedDetails?.includes("email")) continue;
    const value = detailValue(candidate.details, "email");
    if (!value || value.trim().toLowerCase() !== normalized) continue;
    if (!isVerified(candidate.detailsMeta, "email")) continue;
    fingerprints.add(fingerprint);
  }
  if (fingerprints.size === 1) {
    return { status: "unique", fingerprint: [...fingerprints][0] };
  }
  if (fingerprints.size === 0) return { status: "none" };
  return { status: "ambiguous" };
}

export async function searchVerifiedEmailIdentity(
  email: string,
  fetchPage: (page: number, limit: number) => Promise<VerifiedEmailPage>,
): Promise<VerifiedEmailMatch> {
  const trimmed = email.trim();
  if (!trimmed.includes("@")) return { status: "none" };
  const seen: EmailIdentityCandidate[] = [];
  for (let page = 1; page <= VERIFIED_EMAIL_SEARCH_MAX_PAGES; page += 1) {
    const result = await fetchPage(page, VERIFIED_EMAIL_SEARCH_PAGE_SIZE);
    seen.push(...result.identities);
    const current = matchVerifiedEmailIdentities(seen, trimmed);
    if (current.status === "ambiguous") return current;
    if (!result.hasNextPage || result.identities.length === 0) return current;
  }
  return { status: "ambiguous" };
}

/**
 * Local email matches win. A saved contact with the server fingerprint is
 * pinned and is not replaced. Import only when the server match is unique
 * and the device has no copy of that fingerprint.
 */
export function decideRecipientResolution(input: {
  localEmailMatches: LocalContactRef[];
  serverMatch: VerifiedEmailMatch;
  localFingerprintMatches: LocalContactRef[];
}): RecipientResolution {
  if (input.localEmailMatches.length === 1) {
    return {
      action: "use",
      name: input.localEmailMatches[0].name,
      source: "local",
    };
  }
  if (input.localEmailMatches.length > 1) return { action: "unresolved" };
  if (input.serverMatch.status !== "unique") return { action: "unresolved" };
  const fingerprint = input.serverMatch.fingerprint;
  const pinned = input.localFingerprintMatches.filter(
    (contact) => contact.fingerprint === fingerprint,
  );
  if (pinned.length === 1) {
    return { action: "use", name: pinned[0].name, source: "pinned" };
  }
  if (pinned.length > 1) return { action: "unresolved" };
  return { action: "import", fingerprint };
}
