import {sha256Hex} from "../../core/MessageHash.ts";
import { detailProofNonce } from "./detail-nonces.ts";
export {
  coerceNumber,
  DatabaseAdapter,
  type DatabaseQueryParams,
} from "./adapter.ts";
export type { SqliteDatabaseAdapter } from "./sqlite.ts";
export { loadEnvOnce, PostgresDatabaseAdapter } from "./postgres.ts";

import { coerceNumber, DatabaseAdapter } from "./adapter.ts";
import { loadEnvOnce, PostgresDatabaseAdapter } from "./postgres.ts";
import type {
  AllDetailsMap,
  DetailsMap,
  IdentityRow,
  PendingHierarchyProposalRow,
  RevocationRow,
} from "../types.ts";

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function initDb(path: string): Promise<DatabaseAdapter> {
  loadEnvOnce();
  const dbTypeRaw = Deno.env.get("DB_TYPE") ?? Deno.env.get("DB_BACKEND") ??
    "sqlite";
  const backend = dbTypeRaw.toLowerCase();
  if (
    backend === "psql" || backend === "postgres" || backend === "postgresql"
  ) {
    const adapter = PostgresDatabaseAdapter.createFromEnv();
    await adapter.initializeSchema();
    return adapter;
  }
  const { SqliteDatabaseAdapter } = await import("./sqlite.ts");
  return new SqliteDatabaseAdapter(path);
}

export async function insertIdentity(db: DatabaseAdapter, record: {
  fingerprint: string;
  signingKeyType: "dilithium" | "sphincs";
  encryptionKeyType: "kyber";
  signingKey: string;
  encryptionKey: string;
  signingKeyDetails: Record<string, unknown> | null;
  encryptionKeyDetails: Record<string, unknown> | null;
  createdAt: number;
}): Promise<void> {
  await db.query(
    `INSERT INTO identities (
      fingerprint, signing_key_type, encryption_key_type,
      signing_key, encryption_key,
      signing_key_details, encryption_key_details,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.fingerprint,
      record.signingKeyType,
      record.encryptionKeyType,
      record.signingKey,
      record.encryptionKey,
      record.signingKeyDetails
        ? JSON.stringify(record.signingKeyDetails)
        : null,
      record.encryptionKeyDetails
        ? JSON.stringify(record.encryptionKeyDetails)
        : null,
      record.createdAt,
    ],
  );
}

export async function insertDetail(db: DatabaseAdapter, record: {
  fingerprint: string;
  path: string;
  detail: string;
  proof: string;
  createdAt: number;
}): Promise<void> {
  await db.query(
    `INSERT INTO details (identity_fingerprint, path, detail, proof, created_at, proof_nonce)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.fingerprint,
      record.path,
      record.detail,
      record.proof,
      record.createdAt,
      detailProofNonce(record.proof),
    ],
  );
}

export async function getDetailRecord(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
): Promise<
  {
    detail: string;
    proof: string;
    revoked_at: number | null;
    revocation_certificate: string | null;
    verified_at: number | null;
    verification_token: string | null;
    verification_token_hash: string | null;
    verification_expires_at: number | null;
    verification_sent_at: number | null;
  } | null
> {
  const rows = await db.query<
    [
      string,
      string,
      number | string | bigint | null,
      string | null,
      number | string | bigint | null,
      string | null,
      string | null,
      number | string | bigint | null,
      number | string | bigint | null,
    ]
  >(
    `SELECT detail, proof,
            CAST(revoked_at AS TEXT), revocation_certificate,
            CAST(verified_at AS TEXT), verification_token, verification_token_hash,
            CAST(verification_expires_at AS TEXT), CAST(verification_sent_at AS TEXT)
     FROM details WHERE identity_fingerprint = ? AND path = ?`,
    [fingerprint, path],
  );
  if (rows.length === 0) {
    return null;
  }
  const [
    detail,
    proof,
    revoked_at,
    revocation_certificate,
    verified_at,
    verification_token,
    verification_token_hash,
    verification_expires_at,
    verification_sent_at,
  ] = rows[0];
  return {
    detail,
    proof,
    revoked_at: coerceNumber(revoked_at),
    revocation_certificate,
    verified_at: coerceNumber(verified_at),
    verification_token,
    verification_token_hash,
    verification_expires_at: coerceNumber(verification_expires_at),
    verification_sent_at: coerceNumber(verification_sent_at),
  };
}

export async function updateDetail(db: DatabaseAdapter, record: {
  fingerprint: string;
  path: string;
  detail: string;
  proof: string;
  createdAt: number;
}): Promise<void> {
  await db.query(
    `UPDATE details
     SET detail = ?, proof = ?, created_at = ?, proof_nonce = ?, revoked_at = NULL, revocation_certificate = NULL,
         verified_at = NULL, verification_token = NULL, verification_token_hash = NULL,
         verification_expires_at = NULL, verification_sent_at = NULL
     WHERE identity_fingerprint = ? AND path = ?`,
    [
      record.detail,
      record.proof,
      record.createdAt,
      detailProofNonce(record.proof),
      record.fingerprint,
      record.path,
    ],
  );
}

export async function updateDetailVerification(db: DatabaseAdapter, record: {
  fingerprint: string;
  path: string;
  verifiedAt: number | null;
  verificationToken: string | null;
  verificationTokenHash: string | null;
  verificationExpiresAt: number | null;
  verificationSentAt: number | null;
}): Promise<void> {
  await db.query(
    `UPDATE details
     SET verified_at = ?, verification_token = ?, verification_token_hash = ?, verification_expires_at = ?, verification_sent_at = ?
     WHERE identity_fingerprint = ? AND path = ?`,
    [
      record.verifiedAt,
      record.verificationToken,
      record.verificationTokenHash,
      record.verificationExpiresAt,
      record.verificationSentAt,
      record.fingerprint,
      record.path,
    ],
  );
}

/** Issue a token only for the exact signed claim that was inspected. */
export async function issueDetailVerification(
  db: DatabaseAdapter,
  record: { fingerprint: string; path: string; detail: string; proof: string; token: string | null;
    tokenHash: string; expiresAt: number; sentAt: number; recipientHash?: string },
): Promise<boolean> {
  const recipient = record.recipientHash ?? sha256Hex(record.detail.trim().toLowerCase());
  // Shared across automatic issuance and signed resends, across server processes.
  return db.writeTransaction(async tx => {
    const budgets = await tx.query<[number | bigint, number | bigint]>(
      "SELECT window_start, sent_count FROM verification_recipient_budget WHERE recipient_hash = ?", [recipient]);
    const current = budgets[0];
    const sameWindow = current && Number(current[0]) > record.sentAt - 24 * 60 * 60_000;
    const windowStart = sameWindow ? Number(current[0]) : record.sentAt;
    const sentCount = sameWindow ? Number(current[1]) : 0;
    if (sentCount >= 3) return false;
    const rows = await tx.query<[number]>(`UPDATE details SET verified_at = NULL, verification_token = ?,
      verification_token_hash = ?, verification_expires_at = ?, verification_sent_at = ?
      WHERE identity_fingerprint = ? AND path = ? AND detail = ? AND proof = ?
        AND revoked_at IS NULL AND verified_at IS NULL
        AND (verification_expires_at IS NULL OR verification_expires_at <= ?)
        AND (verification_sent_at IS NULL OR verification_sent_at <= ?)
      RETURNING id`, [record.token, record.tokenHash, record.expiresAt, record.sentAt,
        record.fingerprint, record.path, record.detail, record.proof, record.sentAt, record.sentAt - 15 * 60_000]);
    if (!rows.length) return false;
    await tx.query(`INSERT INTO verification_recipient_budget(recipient_hash, window_start, sent_count) VALUES (?, ?, ?)
      ON CONFLICT(recipient_hash) DO UPDATE SET window_start = excluded.window_start, sent_count = excluded.sent_count`,
      [recipient, windowStart, sentCount + 1]);
    return true;
  }, "verification-issuance");
}

/** Consume a live token and verify its claim in one database operation. */
export async function consumeDetailVerification(
  db: DatabaseAdapter,
  tokenHash: string,
  now: number,
): Promise<boolean> {
  const rows = await db.query<[number]>(
    `UPDATE details SET verified_at = ?, verification_token = NULL,
       verification_token_hash = NULL, verification_expires_at = NULL
     WHERE verification_token_hash = ? AND revoked_at IS NULL AND verified_at IS NULL
       AND (verification_expires_at IS NULL OR verification_expires_at >= ?)
       AND path IN ('email', 'opaque::email')
     RETURNING id`,
    [now, tokenHash, now],
  );
  return rows.length === 1;
}

export async function getDetailByVerificationToken(
  db: DatabaseAdapter,
  tokenHash: string,
): Promise<
  {
    fingerprint: string;
    path: string;
    detail: string;
    verified_at: number | null;
    verification_expires_at: number | null;
    verification_sent_at: number | null;
    revoked_at: number | null;
  } | null
> {
  const hashRows = await db.query<
    [
      string,
      string,
      string,
      number | string | bigint | null,
      number | string | bigint | null,
      number | string | bigint | null,
      number | string | bigint | null,
    ]
  >(
    `SELECT identity_fingerprint, path, detail,
            CAST(verified_at AS TEXT), CAST(verification_expires_at AS TEXT),
            CAST(verification_sent_at AS TEXT), CAST(revoked_at AS TEXT)
     FROM details WHERE verification_token_hash = ?`,
    [tokenHash],
  );
  const rows = hashRows;
  if (rows.length === 0) return null;
  const [
    fingerprint,
    path,
    detail,
    verified_at,
    verification_expires_at,
    verification_sent_at,
    revoked_at,
  ] = rows[0];
  return {
    fingerprint,
    path,
    detail,
    verified_at: coerceNumber(verified_at),
    verification_expires_at: coerceNumber(verification_expires_at),
    verification_sent_at: coerceNumber(verification_sent_at),
    revoked_at: coerceNumber(revoked_at),
  };
}

export async function getIdentity(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<IdentityRow | undefined> {
  const rows = await db.query<
    [
      string,
      string,
      string,
      string,
      string,
      string | null,
      string | null,
      number | string | bigint,
      number | string | bigint | null,
      string | null,
    ]
  >(
    `SELECT fingerprint, signing_key_type, encryption_key_type, signing_key, encryption_key,
            signing_key_details, encryption_key_details, created_at, revoked_at, revocation_certificate
     FROM identities WHERE fingerprint = ?`,
    [fingerprint],
  );
  const row = rows[0];

  if (!row) return undefined;
  const [
    fp,
    skt,
    ekt,
    sk,
    ek,
    skd,
    ekd,
    created_at,
    revoked_at,
    revocation_certificate,
  ] = row;
  return {
    fingerprint: fp,
    signing_key_type: skt as IdentityRow["signing_key_type"],
    encryption_key_type: ekt as IdentityRow["encryption_key_type"],
    signing_key: sk,
    encryption_key: ek,
    signing_key_details: skd ? JSON.parse(skd) : null,
    encryption_key_details: ekd ? JSON.parse(ekd) : null,
    created_at: coerceNumber(created_at) ?? 0,
    revoked_at: coerceNumber(revoked_at),
    revocation_certificate,
  };
}

/** One detail projection supplies values, verification flags, and revocation paths. */
export async function getIdentityDetailView(db: DatabaseAdapter, fingerprint: string) {
  const details: DetailsMap = {};
  const detailsMeta: Record<string, {verified: boolean; verifiedAt: number | null}> = {};
  const revokedDetails: string[] = [];
  const rows = await db.query<[string, string, string, number | bigint | null, number | bigint | null]>(
    "SELECT path, detail, proof, verified_at, revoked_at FROM details WHERE identity_fingerprint = ? ORDER BY id ASC", [fingerprint]);
  for (const [path, detail, proof, verified, revoked] of rows) {
    Object.defineProperty(details, path, {value: [detail, proof], enumerable: true});
    Object.defineProperty(detailsMeta, path, {value: {verified: verified !== null && revoked === null, verifiedAt: coerceNumber(verified)}, enumerable: true});
    if (revoked !== null) revokedDetails.push(path);
  }
  return {details, detailsMeta, revokedDetails};
}

export async function getDetailsMap(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<DetailsMap> {
  const details: DetailsMap = {};
  for (
    const [path, detailValue, proof] of await db.query<
      [string, string, string]
    >(
      "SELECT path, detail, proof FROM details WHERE identity_fingerprint = ? ORDER BY id ASC",
      [fingerprint],
    )
  ) {
    details[path] = [detailValue, proof];
  }
  return details;
}

export async function getDetailsMetaMap(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<Record<string, { verified: boolean; verifiedAt: number | null }>> {
  const meta: Record<string, { verified: boolean; verifiedAt: number | null }> =
    {};
  for (
    const [path, verified_at, revoked_at] of await db.query<
      [string, number | string | bigint | null, number | string | bigint | null]
    >(
      "SELECT path, verified_at, revoked_at FROM details WHERE identity_fingerprint = ? ORDER BY id ASC",
      [fingerprint],
    )
  ) {
    const verifiedAt = coerceNumber(verified_at);
    const revokedAt = coerceNumber(revoked_at);
    meta[path] = {
      verified: verifiedAt !== null && revokedAt === null,
      verifiedAt,
    };
  }
  return meta;
}

export async function getAllDetailsMap(
  db: DatabaseAdapter,
): Promise<AllDetailsMap> {
  const detailsByIdentity: AllDetailsMap = {};
  for (
    const [identityFingerprint, path, detail, proof] of await db.query<
      [string, string, string, string]
    >(
      "SELECT identity_fingerprint, path, detail, proof FROM details ORDER BY id ASC",
    )
  ) {
    if (!detailsByIdentity[identityFingerprint]) {
      detailsByIdentity[identityFingerprint] = {};
    }
    detailsByIdentity[identityFingerprint][path] = [detail, proof];
  }
  return detailsByIdentity;
}

export async function ensureNewNonce(
  db: DatabaseAdapter,
  fingerprint: string,
  nonce: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    return { ok: false, error: "nonce must be increasing" };
  }
  const rows = await db.query<[number | string | bigint | null]>(
    `SELECT MAX(nonce) FROM (
      SELECT proof_nonce AS nonce FROM details WHERE identity_fingerprint = ?
      UNION ALL SELECT proof_nonce AS nonce FROM mail_payment_orders WHERE identity_fingerprint = ?
      UNION ALL SELECT nonce FROM authorization_nonces WHERE identity_fingerprint = ?
    ) AS accepted_nonces`,
    [fingerprint, fingerprint, fingerprint],
  );
  const maxNonce = coerceNumber(rows[0]?.[0] ?? null) ?? -1;
  if (nonce === maxNonce && maxNonce >= 0) {
    return { ok: false, error: "nonce already used" };
  }

  if (nonce <= maxNonce) {
    return { ok: false, error: "nonce must be increasing" };
  }

  return { ok: true };
}

/** Atomic reservation; callers combine this with their mutation in an identity transaction. */
export async function consumeNonce(db: DatabaseAdapter, fingerprint: string, nonce: number): Promise<{ok: true} | {ok: false; error: string}> {
  const check = await ensureNewNonce(db, fingerprint, nonce);
  if (!check.ok) return check;
  const rows = await db.query<[number]>(`INSERT INTO authorization_nonces(identity_fingerprint, nonce)
    VALUES (?, ?) ON CONFLICT(identity_fingerprint) DO UPDATE SET nonce = excluded.nonce
    WHERE authorization_nonces.nonce < excluded.nonce RETURNING nonce`, [fingerprint, nonce]);
  return rows.length ? {ok: true} : {ok: false, error: "nonce already used"};
}

export async function insertRevocation(db: DatabaseAdapter, record: {
  fingerprint: string;
  type: "detail" | "identity";
  target: string | null;
  nonce: number;
  certificate: string;
  createdAt: number;
}): Promise<void> {
  await db.query(
    `INSERT INTO revocations (identity_fingerprint, type, target, nonce, certificate, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      record.fingerprint,
      record.type,
      record.target,
      record.nonce,
      record.certificate,
      record.createdAt,
    ],
  );
}

/** Exact upload retries are idempotent; a different certificate cannot reuse a nonce. */
export async function hasMatchingRevocation(
  db: DatabaseAdapter,
  fingerprint: string,
  nonce: number,
  certificate: string,
  type: "detail" | "identity",
  target?: string,
): Promise<boolean> {
  const rows = await db.query<[string, string, string | null]>(
    "SELECT certificate, type, target FROM revocations WHERE identity_fingerprint = ? AND nonce = ?",
    [fingerprint, nonce],
  );
  return rows.some(([storedCertificate, storedType, storedTarget]) =>
    storedCertificate === certificate && storedType === type &&
    storedTarget === (target ?? null)
  );
}

export async function getMaxRevocationNonce(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<number> {
  let maxNonce = -1;
  for (
    const [nonce] of await db.query<[number | string | bigint]>(
      "SELECT nonce FROM revocations WHERE identity_fingerprint = ?",
      [fingerprint],
    )
  ) {
    const parsedNonce = coerceNumber(nonce);
    if (parsedNonce !== null && parsedNonce > maxNonce) {
      maxNonce = parsedNonce;
    }
  }
  return maxNonce;
}

// F-CRYPTO-01: return the max nonce among revocations with nonce strictly
// less than `ceiling` (used to separate "regular" from "emergency" nonce
// spaces). Returns -1 if no matching rows exist.
export async function getMaxRevocationNonceBelow(
  db: DatabaseAdapter,
  fingerprint: string,
  ceiling: number,
): Promise<number> {
  const rows = await db.query<[number | string | bigint | null]>(
    "SELECT MAX(nonce) FROM revocations WHERE identity_fingerprint = ? AND nonce < ?",
    [fingerprint, ceiling],
  );
  return coerceNumber(rows[0]?.[0] ?? null) ?? -1;
}

export async function hasRevocationWithNonce(
  db: DatabaseAdapter,
  fingerprint: string,
  nonce: number,
): Promise<boolean> {
  const rows = await db.query<[number]>(
    "SELECT 1 FROM revocations WHERE identity_fingerprint = ? AND nonce = ?",
    [fingerprint, nonce],
  );
  return rows.length > 0;
}

export async function revokeIdentity(
  db: DatabaseAdapter,
  fingerprint: string,
  certificate: string,
  revokedAt: number,
): Promise<void> {
  await db.query(
    `UPDATE identities SET revoked_at = ?, revocation_certificate = ? WHERE fingerprint = ?`,
    [revokedAt, certificate, fingerprint],
  );
}

export async function revokeDetail(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
  certificate: string,
  revokedAt: number,
): Promise<void> {
  await db.query(
    `UPDATE details
     SET revoked_at = ?, revocation_certificate = ?,
         verified_at = NULL, verification_token = NULL, verification_token_hash = NULL,
         verification_expires_at = NULL, verification_sent_at = NULL
     WHERE identity_fingerprint = ? AND path = ?`,
    [revokedAt, certificate, fingerprint, path],
  );
}

export async function isIdentityRevoked(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<boolean> {
  const rows = await db.query<[number | string | bigint | null]>(
    "SELECT revoked_at FROM identities WHERE fingerprint = ?",
    [fingerprint],
  );
  const revokedAt = rows.length > 0 ? coerceNumber(rows[0][0]) : null;
  return revokedAt !== null;
}

export async function isDetailRevoked(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
): Promise<boolean> {
  const rows = await db.query<[number | string | bigint | null]>(
    "SELECT revoked_at FROM details WHERE identity_fingerprint = ? AND path = ?",
    [fingerprint, path],
  );
  const revokedAt = rows.length > 0 ? coerceNumber(rows[0][0]) : null;
  return revokedAt !== null;
}

export async function getRevocations(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<RevocationRow[]> {
  const rows: RevocationRow[] = [];
  for (
    const [id, identityFp, type, target, nonce, certificate, createdAt]
      of await db.query<
        [
          number | string | bigint,
          string,
          string,
          string | null,
          number | string | bigint,
          string,
          number | string | bigint,
        ]
      >(
        "SELECT id, identity_fingerprint, type, target, nonce, certificate, created_at FROM revocations WHERE identity_fingerprint = ? ORDER BY nonce ASC",
        [fingerprint],
      )
  ) {
    rows.push({
      id: coerceNumber(id) ?? 0,
      identity_fingerprint: identityFp,
      type: type as "detail" | "identity",
      target,
      nonce: coerceNumber(nonce) ?? 0,
      certificate,
      created_at: coerceNumber(createdAt) ?? 0,
    });
  }
  return rows;
}

export async function getRevokedDetailPaths(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (
    const [path] of await db.query<[string]>(
      "SELECT path FROM details WHERE identity_fingerprint = ? AND revoked_at IS NOT NULL",
      [fingerprint],
    )
  ) {
    paths.push(path);
  }
  return paths;
}

export async function insertPendingProposal(db: DatabaseAdapter, record: {
  masterFingerprint: string;
  childFingerprint: string;
  proposerFingerprint: string;
  certificate: string;
  context: string;
  expiry: number;
  createdAt: number;
}): Promise<boolean> {
  const rows = await db.query<[number]>(
    `INSERT INTO pending_hierarchy_proposals (
       master_fingerprint, child_fingerprint, proposer_fingerprint, certificate, context, expiry, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (master_fingerprint, child_fingerprint) DO NOTHING RETURNING id`,
    [
      record.masterFingerprint,
      record.childFingerprint,
      record.proposerFingerprint,
      record.certificate,
      record.context,
      record.expiry,
      record.createdAt,
    ],
  );
  return rows.length === 1;
}

export async function getPendingProposal(
  db: DatabaseAdapter,
  id: number,
): Promise<PendingHierarchyProposalRow | null> {
  const rows = await db.query<[
    number | string | bigint,
    string,
    string,
    string,
    string,
    string,
    number | string | bigint,
    number | string | bigint,
  ]>(
    `SELECT id, master_fingerprint, child_fingerprint, proposer_fingerprint, certificate, context, expiry, created_at
     FROM pending_hierarchy_proposals
     WHERE id = ?`,
    [id],
  );
  if (!rows.length) return null;
  const [
    rowId,
    master,
    child,
    proposer,
    certificate,
    context,
    expiry,
    createdAt,
  ] = rows[0];
  return {
    id: coerceNumber(rowId) ?? 0,
    master_fingerprint: master,
    child_fingerprint: child,
    proposer_fingerprint: proposer,
    certificate,
    context,
    expiry: coerceNumber(expiry) ?? 0,
    created_at: coerceNumber(createdAt) ?? 0,
  };
}

export async function getPendingProposalsForIdentity(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<PendingHierarchyProposalRow[]> {
  const rows: PendingHierarchyProposalRow[] = [];
  for (
    const [id, master, child, proposer, certificate, context, expiry, createdAt]
      of await db.query<[
        number | string | bigint,
        string,
        string,
        string,
        string,
        string,
        number | string | bigint,
        number | string | bigint,
      ]>(
        `SELECT id, master_fingerprint, child_fingerprint, proposer_fingerprint, certificate, context, expiry, created_at
       FROM pending_hierarchy_proposals
       WHERE (master_fingerprint = ? OR child_fingerprint = ?) AND proposer_fingerprint != ?
       ORDER BY created_at ASC, id ASC`,
        [fingerprint, fingerprint, fingerprint],
      )
  ) {
    rows.push({
      id: coerceNumber(id) ?? 0,
      master_fingerprint: master,
      child_fingerprint: child,
      proposer_fingerprint: proposer,
      certificate,
      context,
      expiry: coerceNumber(expiry) ?? 0,
      created_at: coerceNumber(createdAt) ?? 0,
    });
  }
  return rows;
}

export async function getPendingProposalByPair(
  db: DatabaseAdapter,
  masterFingerprint: string,
  childFingerprint: string,
): Promise<PendingHierarchyProposalRow | null> {
  const rows = await db.query<[
    number | string | bigint,
    string,
    string,
    string,
    string,
    string,
    number | string | bigint,
    number | string | bigint,
  ]>(
    `SELECT id, master_fingerprint, child_fingerprint, proposer_fingerprint, certificate, context, expiry, created_at
     FROM pending_hierarchy_proposals
     WHERE master_fingerprint = ? AND child_fingerprint = ?`,
    [masterFingerprint, childFingerprint],
  );
  if (!rows.length) return null;
  const [id, master, child, proposer, certificate, context, expiry, createdAt] =
    rows[0];
  return {
    id: coerceNumber(id) ?? 0,
    master_fingerprint: master,
    child_fingerprint: child,
    proposer_fingerprint: proposer,
    certificate,
    context,
    expiry: coerceNumber(expiry) ?? 0,
    created_at: coerceNumber(createdAt) ?? 0,
  };
}

export async function deletePendingProposal(
  db: DatabaseAdapter,
  id: number,
): Promise<void> {
  await db.query("DELETE FROM pending_hierarchy_proposals WHERE id = ?", [id]);
}

export type MailboxRow = {
  username: string;
  domain: string;
  fingerprint: string;
  stalwartId: string | null;
  active: boolean;
  createdAt: number;
};

function toMailboxRow(
  row: [
    string,
    string,
    string,
    string | null,
    number | string | bigint | boolean,
    number | string | bigint,
  ],
): MailboxRow {
  const [username, domain, fingerprint, stalwartId, active, createdAt] = row;
  return {
    username,
    domain,
    fingerprint,
    stalwartId,
    active: active === true || coerceNumber(active as number) === 1,
    createdAt: coerceNumber(createdAt) ?? 0,
  };
}

const MAILBOX_COLUMNS =
  "username, domain, identity_fingerprint, stalwart_id, active, created_at";

export async function insertMailbox(db: DatabaseAdapter, record: {
  username: string;
  domain: string;
  fingerprint: string;
  stalwartId: string | null;
  createdAt: number;
}): Promise<void> {
  await db.query(
    `INSERT INTO mailboxes (username, domain, identity_fingerprint, stalwart_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      record.username,
      record.domain,
      record.fingerprint,
      record.stalwartId,
      record.createdAt,
    ],
  );
}

export async function setMailboxStalwartId(
  db: DatabaseAdapter,
  username: string,
  domain: string,
  stalwartId: string,
): Promise<void> {
  await db.query(
    "UPDATE mailboxes SET stalwart_id = ? WHERE username = ? AND domain = ?",
    [stalwartId, username, domain],
  );
}

export async function deleteMailbox(
  db: DatabaseAdapter,
  username: string,
  domain: string,
): Promise<void> {
  await db.query("DELETE FROM mailboxes WHERE username = ? AND domain = ?", [
    username,
    domain,
  ]);
}

export async function deleteDetail(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
): Promise<void> {
  await db.query(
    "DELETE FROM details WHERE identity_fingerprint = ? AND path = ?",
    [fingerprint, path],
  );
}

/** `e2e…` mailboxes created at or before `olderThan`. Age is compared in SQL. */
export async function listOldE2eMailboxes(
  db: DatabaseAdapter,
  domain: string,
  olderThan: number,
): Promise<MailboxRow[]> {
  const rows = await db.query<Parameters<typeof toMailboxRow>[0]>(
    `SELECT ${MAILBOX_COLUMNS} FROM mailboxes
     WHERE domain = ? AND username LIKE 'e2e%' AND created_at <= ?`,
    [domain, olderThan],
  );
  return rows.map(toMailboxRow);
}

export async function getMailboxByUsername(
  db: DatabaseAdapter,
  username: string,
  domain: string,
): Promise<MailboxRow | null> {
  const rows = await db.query<Parameters<typeof toMailboxRow>[0]>(
    `SELECT ${MAILBOX_COLUMNS} FROM mailboxes WHERE username = ? AND domain = ?`,
    [username, domain],
  );
  return rows.length ? toMailboxRow(rows[0]) : null;
}

export async function getMailboxByFingerprint(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<MailboxRow | null> {
  const rows = await db.query<Parameters<typeof toMailboxRow>[0]>(
    `SELECT ${MAILBOX_COLUMNS} FROM mailboxes WHERE identity_fingerprint = ?`,
    [fingerprint],
  );
  return rows.length ? toMailboxRow(rows[0]) : null;
}

export async function isMailboxUsernameTaken(
  db: DatabaseAdapter,
  username: string,
  domain: string,
): Promise<boolean> {
  if (await getMailboxByUsername(db, username, domain)) return true;
  return await isMailUsernameRetired(db, username, domain);
}

/** Retired usernames are never reissued, so pinned addresses cannot be taken over. */
export async function retireMailUsername(db: DatabaseAdapter, record: {
  username: string;
  domain: string;
  fingerprint: string;
  retiredAt: number;
}): Promise<void> {
  if (await isMailUsernameRetired(db, record.username, record.domain)) return;
  await db.query(
    `INSERT INTO retired_mail_usernames (username, domain, identity_fingerprint, retired_at)
     VALUES (?, ?, ?, ?)`,
    [record.username, record.domain, record.fingerprint, record.retiredAt],
  );
}

export async function isMailUsernameRetired(
  db: DatabaseAdapter,
  username: string,
  domain: string,
): Promise<boolean> {
  const rows = await db.query<[string]>(
    "SELECT username FROM retired_mail_usernames WHERE username = ? AND domain = ?",
    [username, domain],
  );
  return rows.length > 0;
}

export async function markDetailVerified(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
  verifiedAt: number,
): Promise<void> {
  await updateDetailVerification(db, {
    fingerprint,
    path,
    verifiedAt,
    verificationToken: null,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    verificationSentAt: null,
  });
}

export type SearchResult = {
  fingerprint: string;
  signing_key_type: "dilithium" | "sphincs";
  encryption_key_type: "kyber";
  created_at: number;
};

export async function searchIdentities(
  db: DatabaseAdapter,
  query: string,
  options: { page?: number; limit?: number; includeRevoked?: boolean } = {},
): Promise<{ results: SearchResult[]; total: number }> {
  const { page = 1, limit = 10, includeRevoked = false } = options;
  const offset = (page - 1) * limit;
  const like = `%${escapeLikePattern(query.toLowerCase())}%`;

  const baseJoin =
    "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email') AND d.revoked_at IS NULL";
  const matchClause =
    "(LOWER(i.fingerprint) LIKE ? ESCAPE '\\' OR LOWER(d.detail) LIKE ? ESCAPE '\\')";
  const revokedFilter = includeRevoked
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

  const countQuery =
    `SELECT COUNT(DISTINCT i.fingerprint) ${baseJoin} WHERE ${matchClause} ${revokedFilter}`;
  const totalRows = await db.query<[number | string | bigint]>(countQuery, [
    like,
    like,
  ]);
  const total = coerceNumber(totalRows[0]?.[0] ?? null) ?? 0;

  const listQuery =
    `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at ` +
    `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT ? OFFSET ?`;
  const rows = await db.query<
    [string, string, string, number | string | bigint]
  >(listQuery, [like, like, limit, offset]);
  const results: SearchResult[] = [];
  for (const [fp, skt, ekt, created_at] of rows) {
    results.push({
      fingerprint: fp,
      signing_key_type: skt as "dilithium" | "sphincs",
      encryption_key_type: ekt as "kyber",
      created_at: coerceNumber(created_at) ?? 0,
    });
  }

  return { results, total };
}
