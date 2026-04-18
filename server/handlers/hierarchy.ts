import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { readJsonBody, validateStringLength, LIMITS } from "../body.ts";
import { json } from "../response.ts";
import {
  deletePendingProposal,
  getIdentity,
  getPendingProposal,
  getPendingProposalsForIdentity,
} from "../db.ts";
import type { DatabaseAdapter } from "../db.ts";
import {
  acceptPendingHierarchyProposal,
  getHierarchyCertificateByChild,
  getHierarchyForIdentity,
  verifyAndStorePendingHierarchyProposal,
  verifyAndInsertHierarchyCertificate,
} from "../hierarchy.ts";
import type {
  HierarchyAcceptPayload,
  HierarchyCertificatePayload,
  HierarchyProposalPayload,
  HierarchyRejectPayload,
} from "../types.ts";

export async function handlePostHierarchy(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<HierarchyCertificatePayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }

  const certificateCheck = validateStringLength(
    bodyResult.data.certificate,
    "certificate",
    LIMITS.certificate,
  );
  if (!certificateCheck.ok) {
    return json({ error: certificateCheck.error }, 400);
  }

  const insertResult = await verifyAndInsertHierarchyCertificate(db, certificateCheck.value);
  if (!insertResult.ok) {
    return json({ error: insertResult.error }, 400);
  }

  return json({
    ok: true,
    hierarchy: {
      masterFingerprint: insertResult.row.master_fingerprint,
      childFingerprint: insertResult.row.child_fingerprint,
      timestamp: insertResult.row.timestamp,
      expiry: insertResult.row.expiry,
      context: insertResult.row.context,
      certificate: insertResult.row.certificate,
    },
  });
}

export async function handlePostHierarchyPropose(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<HierarchyProposalPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }

  const proposerCheck = validateStringLength(
    bodyResult.data.proposerFingerprint,
    "proposerFingerprint",
    LIMITS.fingerprint,
  );
  if (!proposerCheck.ok) return json({ error: proposerCheck.error }, 400);
  if (!isValidFingerprintBech32(proposerCheck.value)) {
    return json({ error: "proposerFingerprint must be valid bech32" }, 400);
  }

  const certificateCheck = validateStringLength(
    bodyResult.data.certificate,
    "certificate",
    LIMITS.certificate,
  );
  if (!certificateCheck.ok) return json({ error: certificateCheck.error }, 400);

  const result = await verifyAndStorePendingHierarchyProposal(
    db,
    certificateCheck.value,
    proposerCheck.value,
  );
  if (!result.ok) return json({ error: result.error }, 400);

  return json({
    ok: true,
    proposal: {
      id: result.proposal.id,
      masterFingerprint: result.proposal.master_fingerprint,
      childFingerprint: result.proposal.child_fingerprint,
      proposerFingerprint: result.proposal.proposer_fingerprint,
      context: result.proposal.context,
      expiry: result.proposal.expiry,
      createdAt: result.proposal.created_at,
      certificate: result.proposal.certificate,
    },
  });
}

export async function handleGetHierarchyPending(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }
  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const proposals = await getPendingProposalsForIdentity(db, fingerprint);
  return json({
    fingerprint,
    proposals: proposals.map((p) => ({
      id: p.id,
      masterFingerprint: p.master_fingerprint,
      childFingerprint: p.child_fingerprint,
      proposerFingerprint: p.proposer_fingerprint,
      context: p.context,
      expiry: p.expiry,
      createdAt: p.created_at,
      certificate: p.certificate,
    })),
  });
}

export async function handlePostHierarchyAccept(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<HierarchyAcceptPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const proposalId = Number(bodyResult.data.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return json({ error: "proposalId must be a positive integer" }, 400);
  }
  const certCheck = validateStringLength(bodyResult.data.certificate, "certificate", LIMITS.certificate);
  if (!certCheck.ok) return json({ error: certCheck.error }, 400);

  const result = await acceptPendingHierarchyProposal(db, proposalId, certCheck.value);
  if (!result.ok) return json({ error: result.error }, 400);
  return json({
    ok: true,
    hierarchy: {
      masterFingerprint: result.row.master_fingerprint,
      childFingerprint: result.row.child_fingerprint,
      timestamp: result.row.timestamp,
      expiry: result.row.expiry,
      context: result.row.context,
      certificate: result.row.certificate,
    },
  });
}

export async function handlePostHierarchyReject(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<HierarchyRejectPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const proposalId = Number(bodyResult.data.proposalId);
  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return json({ error: "proposalId must be a positive integer" }, 400);
  }
  const fingerprintCheck = validateStringLength(bodyResult.data.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const proposal = await getPendingProposal(db, proposalId);
  if (!proposal) {
    return json({ error: "pending proposal not found" }, 404);
  }
  if (proposal.proposer_fingerprint === fingerprint) {
    return json({ error: "proposer cannot reject their own proposal" }, 403);
  }
  if (proposal.master_fingerprint !== fingerprint && proposal.child_fingerprint !== fingerprint) {
    return json({ error: "fingerprint is not part of this proposal" }, 403);
  }

  await deletePendingProposal(db, proposalId);
  return json({ ok: true });
}

export async function handleGetHierarchy(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const hierarchy = await getHierarchyForIdentity(db, fingerprint);
  return json({
    fingerprint,
    root: hierarchy.root,
    ancestors: hierarchy.ancestors,
    descendants: hierarchy.descendants,
    allFingerprints: hierarchy.allFingerprints,
    relationships: hierarchy.relationships.map((row) => ({
      masterFingerprint: row.master_fingerprint,
      childFingerprint: row.child_fingerprint,
      timestamp: row.timestamp,
      expiry: row.expiry,
      context: row.context,
      certificate: row.certificate,
      expired: row.expired,
    })),
  });
}

export async function handleGetHierarchyCertificate(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const row = await getHierarchyCertificateByChild(db, fingerprint);
  if (!row) {
    return json({ error: "hierarchy certificate not found" }, 404);
  }

  return json({
    masterFingerprint: row.master_fingerprint,
    childFingerprint: row.child_fingerprint,
    timestamp: row.timestamp,
    expiry: row.expiry,
    context: row.context,
    certificate: row.certificate,
  });
}
