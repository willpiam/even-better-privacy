import {
  decodeAndVerifyHierarchyCertificate,
  decodeHierarchyCertificate,
  isHierarchyCertificateExpired,
  validateHierarchy,
  type SignedHierarchyCertificate,
} from "../core/HierarchyCertificate.ts";
import { getIdentity, type DatabaseAdapter } from "./db.ts";
import type { HierarchyCertificateRow } from "./types.ts";

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
