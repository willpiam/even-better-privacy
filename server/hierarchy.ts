import {
  decodeAndVerifyHierarchyCertificate,
  decodeHierarchyCertificate,
  getHierarchySignaturePayload,
  isHierarchyCertificateExpired,
  validateHierarchy,
  type HierarchyCertificateData,
  type SignedHierarchyCertificate,
} from "../core/HierarchyCertificate.ts";
import { hexToString } from "../core/Hex.ts";
import {
  buildLegacyMessageHashEnvelopeFromHash,
  buildPurposeHashEnvelope,
  sha256Hex,
} from "../core/MessageHash.ts";
import { DilithiumSigningKey } from "../core/Dilithium.ts";
import { SphincsSigningKey } from "../core/Sphincs.ts";
import {
  getIdentity,
  getPendingProposal,
  getPendingProposalByPair,
  insertPendingProposal,
  deletePendingProposal,
  type DatabaseAdapter,
} from "./db/index.ts";
import type { HierarchyCertificateRow, PendingHierarchyProposalRow } from "./types.ts";

function coerceNumber(value: number | string | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

export type VerifiedHierarchyRecord = {
  row: HierarchyCertificateRow;
  certificate: SignedHierarchyCertificate;
  expired: boolean;
};

export async function listHierarchyCertificates(db: DatabaseAdapter): Promise<HierarchyCertificateRow[]> {
  const rows: HierarchyCertificateRow[] = [];
  for (
    const [id, masterFingerprint, childFingerprint, timestamp, expiry, context, certificate, createdAt] of await db
      .query<[number | string | bigint, string, string, number | string | bigint, number | string | bigint, string, string, number | string | bigint]>(
        `SELECT id, master_fingerprint, child_fingerprint, timestamp, expiry, context, certificate, created_at
         FROM hierarchy_certificates
         ORDER BY timestamp ASC, id ASC`,
      )
  ) {
    rows.push({
      id: coerceNumber(id) ?? 0,
      master_fingerprint: masterFingerprint,
      child_fingerprint: childFingerprint,
      timestamp: coerceNumber(timestamp) ?? 0,
      expiry: coerceNumber(expiry) ?? 0,
      context,
      certificate,
      created_at: coerceNumber(createdAt) ?? 0,
    });
  }
  return rows;
}

export async function getHierarchyCertificateByChild(
  db: DatabaseAdapter,
  childFingerprint: string,
): Promise<HierarchyCertificateRow | null> {
  const rows = await db.query<[
    number | string | bigint,
    string,
    string,
    number | string | bigint,
    number | string | bigint,
    string,
    string,
    number | string | bigint,
  ]>(
    `SELECT id, master_fingerprint, child_fingerprint, timestamp, expiry, context, certificate, created_at
     FROM hierarchy_certificates
     WHERE child_fingerprint = ?`,
    [childFingerprint],
  );
  if (rows.length === 0) return null;
  const [id, masterFingerprint, child, timestamp, expiry, context, certificate, createdAt] = rows[0];
  return {
    id: coerceNumber(id) ?? 0,
    master_fingerprint: masterFingerprint,
    child_fingerprint: child,
    timestamp: coerceNumber(timestamp) ?? 0,
    expiry: coerceNumber(expiry) ?? 0,
    context,
    certificate,
    created_at: coerceNumber(createdAt) ?? 0,
  };
}

export async function getDirectChildren(
  db: DatabaseAdapter,
  masterFingerprint: string,
): Promise<HierarchyCertificateRow[]> {
  const rows: HierarchyCertificateRow[] = [];
  for (
    const [id, master, child, timestamp, expiry, context, certificate, createdAt] of await db
      .query<[number | string | bigint, string, string, number | string | bigint, number | string | bigint, string, string, number | string | bigint]>(
        `SELECT id, master_fingerprint, child_fingerprint, timestamp, expiry, context, certificate, created_at
         FROM hierarchy_certificates
         WHERE master_fingerprint = ?
         ORDER BY timestamp ASC, id ASC`,
        [masterFingerprint],
      )
  ) {
    rows.push({
      id: coerceNumber(id) ?? 0,
      master_fingerprint: master,
      child_fingerprint: child,
      timestamp: coerceNumber(timestamp) ?? 0,
      expiry: coerceNumber(expiry) ?? 0,
      context,
      certificate,
      created_at: coerceNumber(createdAt) ?? 0,
    });
  }
  return rows;
}

export async function getMaster(
  db: DatabaseAdapter,
  childFingerprint: string,
): Promise<HierarchyCertificateRow | null> {
  return await getHierarchyCertificateByChild(db, childFingerprint);
}

export async function verifyAndInsertHierarchyCertificate(
  db: DatabaseAdapter,
  encodedCertificate: string,
): Promise<{ ok: true; row: HierarchyCertificateRow } | { ok: false; error: string }> {
  const decoded = decodeHierarchyCertificate(encodedCertificate);
  if (!decoded) {
    return { ok: false, error: "invalid hierarchy certificate encoding" };
  }

  const master = await getIdentity(db, decoded.masterFingerprint);
  const child = await getIdentity(db, decoded.childFingerprint);
  if (!master || !child) {
    return { ok: false, error: "both master and child identities must exist on server" };
  }

  const verifyResult = decodeAndVerifyHierarchyCertificate(
    encodedCertificate,
    {
      fingerprint: master.fingerprint,
      signingKeyType: master.signing_key_type,
      signingKey: master.signing_key,
      signingKeyDetails: (master.signing_key_details ?? {}) as { variant: string } & Record<string, unknown>,
    },
    {
      fingerprint: child.fingerprint,
      signingKeyType: child.signing_key_type,
      signingKey: child.signing_key,
      signingKeyDetails: (child.signing_key_details ?? {}) as { variant: string } & Record<string, unknown>,
    },
  );
  if (!verifyResult.ok) {
    return verifyResult;
  }

  const existing = await listHierarchyCertificates(db);
  const edges = existing.map((row) => ({
    masterFingerprint: row.master_fingerprint,
    childFingerprint: row.child_fingerprint,
  }));
  const hierarchyOk = validateHierarchy(edges, {
    masterFingerprint: decoded.masterFingerprint,
    childFingerprint: decoded.childFingerprint,
  });
  if (!hierarchyOk.ok) {
    return hierarchyOk;
  }

  try {
    await db.query(
      `INSERT INTO hierarchy_certificates (
         master_fingerprint, child_fingerprint, timestamp, expiry, context, certificate, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        decoded.masterFingerprint,
        decoded.childFingerprint,
        decoded.timestamp,
        decoded.expiry,
        decoded.context,
        encodedCertificate,
        Date.now(),
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("unique") || message.includes("duplicate")) {
      return { ok: false, error: "child already has a master" };
    }
    return { ok: false, error: "failed to insert hierarchy certificate" };
  }

  const inserted = await getHierarchyCertificateByChild(db, decoded.childFingerprint);
  if (!inserted) {
    return { ok: false, error: "hierarchy certificate was not found after insert" };
  }
  return { ok: true, row: inserted };
}

type PendingHierarchyCertificate = Omit<HierarchyCertificateData, "masterSignature" | "childSignature"> & {
  masterSignature: string | null;
  childSignature: string | null;
};

function decodePendingHierarchyCertificate(encoded: string): PendingHierarchyCertificate | null {
  try {
    const parsed = JSON.parse(hexToString(encoded)) as PendingHierarchyCertificate;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.masterFingerprint !== "string" || parsed.masterFingerprint.length === 0) return null;
    if (typeof parsed.childFingerprint !== "string" || parsed.childFingerprint.length === 0) return null;
    if (parsed.masterFingerprint === parsed.childFingerprint) return null;
    if (typeof parsed.timestamp !== "number" || !Number.isFinite(parsed.timestamp) || parsed.timestamp < 0) return null;
    if (typeof parsed.expiry !== "number" || !Number.isFinite(parsed.expiry) || parsed.expiry < 0) return null;
    if (typeof parsed.context !== "string") return null;
    if (typeof parsed.salt !== "string" || parsed.salt.length === 0) return null;
    const masterSigOk = parsed.masterSignature === null || typeof parsed.masterSignature === "string";
    const childSigOk = parsed.childSignature === null || typeof parsed.childSignature === "string";
    if (!masterSigOk || !childSigOk) return null;
    return parsed;
  } catch {
    return null;
  }
}

function verifySignerEnvelope(
  signer: { signingKeyType: "dilithium" | "sphincs"; signingKey: string; variant: string },
  payload: string,
  signature: string,
): boolean {
  const envelope = buildPurposeHashEnvelope("hierarchy", payload);
  const legacyEnvelope = buildLegacyMessageHashEnvelopeFromHash(sha256Hex(payload));
  try {
    if (signer.signingKeyType === "dilithium") {
      return DilithiumSigningKey.verify(signer.variant, envelope, signature, signer.signingKey)
        || DilithiumSigningKey.verify(signer.variant, legacyEnvelope, signature, signer.signingKey);
    }
    return SphincsSigningKey.verify(signer.variant, envelope, signature, signer.signingKey)
      || SphincsSigningKey.verify(signer.variant, legacyEnvelope, signature, signer.signingKey);
  } catch {
    return false;
  }
}

export async function verifyAndStorePendingHierarchyProposal(
  db: DatabaseAdapter,
  encodedCertificate: string,
  proposerFingerprint: string,
): Promise<{ ok: true; proposal: PendingHierarchyProposalRow } | { ok: false; error: string }> {
  const decoded = decodePendingHierarchyCertificate(encodedCertificate);
  if (!decoded) {
    return { ok: false, error: "invalid hierarchy certificate encoding" };
  }

  const masterSigned = typeof decoded.masterSignature === "string" && decoded.masterSignature.length > 0;
  const childSigned = typeof decoded.childSignature === "string" && decoded.childSignature.length > 0;
  if ((masterSigned ? 1 : 0) + (childSigned ? 1 : 0) !== 1) {
    return { ok: false, error: "pending proposal must include exactly one signature" };
  }

  const proposerRole = proposerFingerprint === decoded.masterFingerprint
    ? "master"
    : proposerFingerprint === decoded.childFingerprint
    ? "child"
    : null;
  if (!proposerRole) {
    return { ok: false, error: "proposer must be either master or child in the certificate" };
  }
  if (proposerRole === "master" && !masterSigned) {
    return { ok: false, error: "proposer signature missing for master" };
  }
  if (proposerRole === "child" && !childSigned) {
    return { ok: false, error: "proposer signature missing for child" };
  }

  const master = await getIdentity(db, decoded.masterFingerprint);
  const child = await getIdentity(db, decoded.childFingerprint);
  if (!master || !child) {
    return { ok: false, error: "both master and child identities must exist on server" };
  }

  const variant = proposerRole === "master"
    ? (master.signing_key_details as { variant?: string } | null)?.variant
    : (child.signing_key_details as { variant?: string } | null)?.variant;
  if (!variant) {
    return { ok: false, error: "missing signing variant" };
  }
  const signingKeyType = proposerRole === "master" ? master.signing_key_type : child.signing_key_type;
  const signingKey = proposerRole === "master" ? master.signing_key : child.signing_key;
  const signature = proposerRole === "master" ? decoded.masterSignature! : decoded.childSignature!;
  const payload = getHierarchySignaturePayload(decoded);
  const verified = verifySignerEnvelope({ signingKeyType, signingKey, variant }, payload, signature);
  if (!verified) {
    return { ok: false, error: "invalid proposer signature" };
  }

  const existing = await listHierarchyCertificates(db);
  const hierarchyOk = validateHierarchy(
    existing.map((row) => ({
      masterFingerprint: row.master_fingerprint,
      childFingerprint: row.child_fingerprint,
    })),
    {
      masterFingerprint: decoded.masterFingerprint,
      childFingerprint: decoded.childFingerprint,
    },
  );
  if (!hierarchyOk.ok) {
    return hierarchyOk;
  }

  try {
    await insertPendingProposal(db, {
      masterFingerprint: decoded.masterFingerprint,
      childFingerprint: decoded.childFingerprint,
      proposerFingerprint,
      certificate: encodedCertificate,
      context: decoded.context,
      expiry: decoded.expiry,
      createdAt: Date.now(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes("unique") || message.includes("duplicate")) {
      return { ok: false, error: "a pending proposal for this relationship already exists" };
    }
    return { ok: false, error: "failed to store pending hierarchy proposal" };
  }

  const proposal = await getPendingProposalByPair(db, decoded.masterFingerprint, decoded.childFingerprint);
  if (!proposal) {
    return { ok: false, error: "proposal was not found after insert" };
  }
  return { ok: true, proposal };
}

export async function acceptPendingHierarchyProposal(
  db: DatabaseAdapter,
  proposalId: number,
  encodedCertificate: string,
): Promise<{ ok: true; row: HierarchyCertificateRow } | { ok: false; error: string }> {
  const pending = await getPendingProposal(db, proposalId);
  if (!pending) {
    return { ok: false, error: "pending proposal not found" };
  }
  const decoded = decodeHierarchyCertificate(encodedCertificate);
  if (!decoded) {
    return { ok: false, error: "accepted certificate must include both signatures" };
  }
  if (
    decoded.masterFingerprint !== pending.master_fingerprint ||
    decoded.childFingerprint !== pending.child_fingerprint
  ) {
    return { ok: false, error: "accepted certificate does not match pending proposal" };
  }

  const insertResult = await verifyAndInsertHierarchyCertificate(db, encodedCertificate);
  if (!insertResult.ok) return insertResult;
  await deletePendingProposal(db, proposalId);
  return insertResult;
}

export async function getHierarchyForIdentity(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<{
  focus: string;
  relationships: Array<HierarchyCertificateRow & { expired: boolean }>;
  root: string;
  ancestors: string[];
  descendants: string[];
  allFingerprints: string[];
}> {
  const allRows = await listHierarchyCertificates(db);

  const childToRow = new Map<string, HierarchyCertificateRow>();
  const masterToChildren = new Map<string, HierarchyCertificateRow[]>();
  for (const row of allRows) {
    childToRow.set(row.child_fingerprint, row);
    const arr = masterToChildren.get(row.master_fingerprint) ?? [];
    arr.push(row);
    masterToChildren.set(row.master_fingerprint, arr);
  }

  // Find root and ancestor chain.
  const ancestors: string[] = [];
  let current = fingerprint;
  while (true) {
    const parentEdge = childToRow.get(current);
    if (!parentEdge) break;
    ancestors.push(parentEdge.master_fingerprint);
    current = parentEdge.master_fingerprint;
  }
  const root = current;

  // Collect descendants via BFS from root.
  const descendants: string[] = [];
  const relationships: Array<HierarchyCertificateRow & { expired: boolean }> = [];
  const queue = [root];
  const seen = new Set<string>([root]);
  while (queue.length > 0) {
    const node = queue.shift()!;
    const children = masterToChildren.get(node) ?? [];
    for (const edge of children) {
      relationships.push({
        ...edge,
        expired: isHierarchyCertificateExpired({ expiry: edge.expiry }),
      });
      descendants.push(edge.child_fingerprint);
      if (!seen.has(edge.child_fingerprint)) {
        seen.add(edge.child_fingerprint);
        queue.push(edge.child_fingerprint);
      }
    }
  }

  const allFingerprints = Array.from(new Set([root, ...ancestors, ...descendants, fingerprint]));
  return { focus: fingerprint, relationships, root, ancestors, descendants, allFingerprints };
}
