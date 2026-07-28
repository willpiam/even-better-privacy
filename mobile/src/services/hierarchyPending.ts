#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
/** Shared pending-proposal merge helpers (Deno-testable). */

export type PendingHierarchyProposal = {
  id: number;
  masterFingerprint: string;
  childFingerprint: string;
  proposerFingerprint: string;
  certificate: string;
  context: string;
  expiry: number;
  createdAt: number;
  /** Prefer server when both exist for the same master→child pair. */
  source?: 'local' | 'server';
};

export function pendingPairKey(p: {
  masterFingerprint: string;
  childFingerprint: string;
}): string {
  return `${p.masterFingerprint}:${p.childFingerprint}`;
}

/** Merge local + server pending rows; server wins on the same master→child pair. */
export function mergePendingProposals(
  local: PendingHierarchyProposal[],
  server: PendingHierarchyProposal[],
): PendingHierarchyProposal[] {
  const byPair = new Map<string, PendingHierarchyProposal>();
  for (const item of local) {
    byPair.set(pendingPairKey(item), {...item, source: item.source ?? 'local'});
  }
  for (const item of server) {
    byPair.set(pendingPairKey(item), {...item, source: 'server'});
  }
  return Array.from(byPair.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/** Counterparty inbox: involve this identity, but not proposed by it. */
export function filterPendingForIdentity(
  items: PendingHierarchyProposal[],
  identityFingerprint: string,
): PendingHierarchyProposal[] {
  return items.filter(
    p =>
      (p.masterFingerprint === identityFingerprint ||
        p.childFingerprint === identityFingerprint) &&
      p.proposerFingerprint !== identityFingerprint,
  );
}
