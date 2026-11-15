import type { Identity } from "../core/Identity.ts";

/** Reuse the saved certificate after an interrupted upload without advancing its nonce. */
export function prepareIdentityRevocation(
  identity: Identity,
  reason?: string,
): string {
  return identity.revocationCertificate ??
    identity.createIdentityRevocation(reason);
}

export function prepareDetailRevocation(
  identity: Identity,
  path: string,
  reason?: string,
): string {
  // A newly attached value needs a new revocation even if this path was revoked before.
  const saved = identity.revokedDetails.get(path);
  return !identity.details.has(path) && saved
    ? saved
    : identity.revokeDetail(path, reason);
}
