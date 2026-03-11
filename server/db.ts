import { DB } from "sqlite";
import type { QueryParameterSet } from "sqlite";
import { loadSync } from "std/dotenv";
import { Pool } from "postgres";
import { hexToBytes } from "./crypto.ts";
import type {
  AllDetailsMap,
  DetailsMap,
  IdentityRow,
  PendingHierarchyProposalRow,
  RevocationRow,
} from "./types.ts";

const textDecoder = new TextDecoder();

function coerceNumber(value: number | string | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}

export type DatabaseQueryParams =
  | readonly unknown[]
  | Readonly<Record<string, unknown>>;

export abstract class DatabaseAdapter {
  abstract execute(sql: string): Promise<void>;
  abstract query<T extends unknown[]>(sql: string, params?: DatabaseQueryParams): Promise<T[]>;
  abstract close(): Promise<void>;
}

export class SqliteDatabaseAdapter extends DatabaseAdapter {
  private db: DB;

  constructor(path: string) {
    super();
    this.db = new DB(path);
    this.initializeSchema();
  }

  execute(sql: string): Promise<void> {
    this.db.execute(sql);
    return Promise.resolve();
  }

  query<T extends unknown[]>(sql: string, params: DatabaseQueryParams = []): Promise<T[]> {
    return Promise.resolve([...this.db.query<T>(sql, params as QueryParameterSet | undefined)]);
  }

  close(): Promise<void> {
    this.db.close();
    return Promise.resolve();
  }

  private initializeSchema(): void {
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS identities (
        fingerprint TEXT PRIMARY KEY,
        signing_key_type TEXT NOT NULL,
        encryption_key_type TEXT NOT NULL,
        signing_key TEXT NOT NULL,
        encryption_key TEXT NOT NULL,
        signing_key_details TEXT,
        encryption_key_details TEXT,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        revocation_certificate TEXT
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_fingerprint TEXT NOT NULL,
        path TEXT NOT NULL,
        detail TEXT NOT NULL,
        proof TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        verified_at INTEGER,
        verification_token TEXT,
        verification_token_hash TEXT,
        verification_expires_at INTEGER,
        verification_sent_at INTEGER,
        revoked_at INTEGER,
        revocation_certificate TEXT,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(identity_fingerprint, path)
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS revocations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_fingerprint TEXT NOT NULL,
        type TEXT NOT NULL,
        target TEXT,
        nonce INTEGER NOT NULL,
        certificate TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(identity_fingerprint, nonce)
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS hierarchy_certificates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        master_fingerprint TEXT NOT NULL,
        child_fingerprint TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        expiry INTEGER NOT NULL,
        context TEXT NOT NULL,
        certificate TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(master_fingerprint) REFERENCES identities(fingerprint),
        FOREIGN KEY(child_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(child_fingerprint)
      )
    `);

    this.db.execute(`
      CREATE TABLE IF NOT EXISTS pending_hierarchy_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        master_fingerprint TEXT NOT NULL,
        child_fingerprint TEXT NOT NULL,
        proposer_fingerprint TEXT NOT NULL,
        certificate TEXT NOT NULL,
        context TEXT NOT NULL,
        expiry INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(master_fingerprint) REFERENCES identities(fingerprint),
        FOREIGN KEY(child_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(master_fingerprint, child_fingerprint)
      )
    `);

    // Add revocation columns to existing tables if they don't exist (migration)
    try {
      this.db.execute(`ALTER TABLE identities ADD COLUMN revoked_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE identities ADD COLUMN revocation_certificate TEXT`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN revoked_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN revocation_certificate TEXT`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN verified_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN verification_token TEXT`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN verification_token_hash TEXT`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN verification_expires_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.execute(`ALTER TABLE details ADD COLUMN verification_sent_at INTEGER`);
    } catch {
      /* column already exists */
    }
  }
}

let envLoaded = false;

function loadEnvOnce(): void {
  if (envLoaded) return;
  try {
    loadSync({ export: true });
  } catch {
    // ignore missing .env
  }
  envLoaded = true;
}

export class PostgresDatabaseAdapter extends DatabaseAdapter {
  private pool: Pool;

  private constructor(pool: Pool) {
    super();
    this.pool = pool;
  }

  static createFromEnv(): PostgresDatabaseAdapter {
    loadEnvOnce();
    const hostname = Deno.env.get("PG_HOST") ?? "localhost";
    const port = Number(Deno.env.get("PG_PORT") ?? "5432");
    const user = Deno.env.get("PG_USER") ?? "postgres";
    const password = Deno.env.get("PG_PASSWORD") ?? "";
    const database = Deno.env.get("PG_DATABASE") ?? "postgres";
    const poolSize = Number(Deno.env.get("PG_POOL_SIZE") ?? "5");

    const pool = new Pool({
      hostname,
      port,
      user,
      password,
      database,
    }, poolSize, true);

    return new PostgresDatabaseAdapter(pool);
  }

  async execute(sql: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.queryArray(sql);
    } finally {
      client.release();
    }
  }

  async query<T extends unknown[]>(sql: string, params: DatabaseQueryParams = []): Promise<T[]> {
    const client = await this.pool.connect();
    try {
      const { sql: rewrittenSql, params: rewrittenParams } = this.rewriteSql(sql, params);
      const result = await client.queryArray(rewrittenSql, rewrittenParams);
      return result.rows as T[];
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async initializeSchema(): Promise<void> {
    await this.execute(`
      CREATE TABLE IF NOT EXISTS identities (
        fingerprint TEXT PRIMARY KEY,
        signing_key_type TEXT NOT NULL,
        encryption_key_type TEXT NOT NULL,
        signing_key TEXT NOT NULL,
        encryption_key TEXT NOT NULL,
        signing_key_details TEXT,
        encryption_key_details TEXT,
        created_at BIGINT NOT NULL,
        revoked_at BIGINT,
        revocation_certificate TEXT
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS details (
        id BIGSERIAL PRIMARY KEY,
        identity_fingerprint TEXT NOT NULL,
        path TEXT NOT NULL,
        detail TEXT NOT NULL,
        proof TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        verified_at BIGINT,
        verification_token TEXT,
        verification_token_hash TEXT,
        verification_expires_at BIGINT,
        verification_sent_at BIGINT,
        revoked_at BIGINT,
        revocation_certificate TEXT,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(identity_fingerprint, path)
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS revocations (
        id BIGSERIAL PRIMARY KEY,
        identity_fingerprint TEXT NOT NULL,
        type TEXT NOT NULL,
        target TEXT,
        nonce BIGINT NOT NULL,
        certificate TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(identity_fingerprint, nonce)
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS hierarchy_certificates (
        id BIGSERIAL PRIMARY KEY,
        master_fingerprint TEXT NOT NULL,
        child_fingerprint TEXT NOT NULL UNIQUE,
        timestamp BIGINT NOT NULL,
        expiry BIGINT NOT NULL,
        context TEXT NOT NULL,
        certificate TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(master_fingerprint) REFERENCES identities(fingerprint),
        FOREIGN KEY(child_fingerprint) REFERENCES identities(fingerprint)
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS pending_hierarchy_proposals (
        id BIGSERIAL PRIMARY KEY,
        master_fingerprint TEXT NOT NULL,
        child_fingerprint TEXT NOT NULL,
        proposer_fingerprint TEXT NOT NULL,
        certificate TEXT NOT NULL,
        context TEXT NOT NULL,
        expiry BIGINT NOT NULL,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(master_fingerprint) REFERENCES identities(fingerprint),
        FOREIGN KEY(child_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(master_fingerprint, child_fingerprint)
      )
    `);

    await this.execute(`ALTER TABLE identities ADD COLUMN IF NOT EXISTS revoked_at BIGINT`);
    await this.execute(`ALTER TABLE identities ADD COLUMN IF NOT EXISTS revocation_certificate TEXT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS revoked_at BIGINT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS revocation_certificate TEXT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS verified_at BIGINT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS verification_token TEXT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS verification_token_hash TEXT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS verification_expires_at BIGINT`);
    await this.execute(`ALTER TABLE details ADD COLUMN IF NOT EXISTS verification_sent_at BIGINT`);
  }

  private rewriteSql(sql: string, params: DatabaseQueryParams): { sql: string; params: unknown[] } {
    if (!Array.isArray(params)) {
      return { sql, params: [] };
    }
    let index = 0;
    const rewritten = sql.replace(/\?/g, () => `$${++index}`);
    return { sql: rewritten, params };
  }
}

export async function initDb(path: string): Promise<DatabaseAdapter> {
  loadEnvOnce();
  const dbTypeRaw = Deno.env.get("DB_TYPE") ?? Deno.env.get("DB_BACKEND") ?? "sqlite";
  const backend = dbTypeRaw.toLowerCase();
  if (backend === "psql" || backend === "postgres" || backend === "postgresql") {
    const adapter = PostgresDatabaseAdapter.createFromEnv();
    await adapter.initializeSchema();
    return adapter;
  }
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
      record.signingKeyDetails ? JSON.stringify(record.signingKeyDetails) : null,
      record.encryptionKeyDetails ? JSON.stringify(record.encryptionKeyDetails) : null,
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
    `INSERT INTO details (identity_fingerprint, path, detail, proof, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [record.fingerprint, record.path, record.detail, record.proof, record.createdAt],
  );
}

export async function getDetailRecord(
  db: DatabaseAdapter,
  fingerprint: string,
  path: string,
): Promise<{
  detail: string;
  proof: string;
  revoked_at: number | null;
  revocation_certificate: string | null;
  verified_at: number | null;
  verification_token: string | null;
  verification_token_hash: string | null;
  verification_expires_at: number | null;
  verification_sent_at: number | null;
} | null> {
  const rows = await db.query<[string, string, number | string | bigint | null, string | null, number | string | bigint | null, string | null, string | null, number | string | bigint | null, number | string | bigint | null]>(
    "SELECT detail, proof, revoked_at, revocation_certificate, verified_at, verification_token, verification_token_hash, verification_expires_at, verification_sent_at FROM details WHERE identity_fingerprint = ? AND path = ?",
    [fingerprint, path],
  );
  if (rows.length === 0) {
    return null;
  }
  const [detail, proof, revoked_at, revocation_certificate, verified_at, verification_token, verification_token_hash, verification_expires_at, verification_sent_at] = rows[0];
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
     SET detail = ?, proof = ?, created_at = ?, revoked_at = NULL, revocation_certificate = NULL,
         verified_at = NULL, verification_token = NULL, verification_token_hash = NULL,
         verification_expires_at = NULL, verification_sent_at = NULL
     WHERE identity_fingerprint = ? AND path = ?`,
    [record.detail, record.proof, record.createdAt, record.fingerprint, record.path],
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

export async function getDetailByVerificationToken(
  db: DatabaseAdapter,
  tokenHash: string,
  tokenPlaintext: string,
): Promise<{
  fingerprint: string;
  path: string;
  detail: string;
  verified_at: number | null;
  verification_expires_at: number | null;
  verification_sent_at: number | null;
  revoked_at: number | null;
} | null> {
  const rows = await db.query<[string, string, string, number | string | bigint | null, number | string | bigint | null, number | string | bigint | null, number | string | bigint | null]>(
    `SELECT identity_fingerprint, path, detail, verified_at, verification_expires_at, verification_sent_at, revoked_at
     FROM details WHERE verification_token_hash = ? OR verification_token = ?`,
    [tokenHash, tokenPlaintext],
  );
  if (rows.length === 0) return null;
  const [fingerprint, path, detail, verified_at, verification_expires_at, verification_sent_at, revoked_at] = rows[0];
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

export async function getIdentity(db: DatabaseAdapter, fingerprint: string): Promise<IdentityRow | undefined> {
  const rows = await db.query<[string, string, string, string, string, string | null, string | null, number | string | bigint, number | string | bigint | null, string | null]>(
    `SELECT fingerprint, signing_key_type, encryption_key_type, signing_key, encryption_key,
            signing_key_details, encryption_key_details, created_at, revoked_at, revocation_certificate
     FROM identities WHERE fingerprint = ?`,
    [fingerprint],
  );
  const row = rows[0];

  if (!row) return undefined;
  const [fp, skt, ekt, sk, ek, skd, ekd, created_at, revoked_at, revocation_certificate] = row;
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

export async function getDetailsMap(db: DatabaseAdapter, fingerprint: string): Promise<DetailsMap> {
  const details: DetailsMap = {};
  for (const [path, detailValue, proof] of await db.query<[string, string, string]>(
    "SELECT path, detail, proof FROM details WHERE identity_fingerprint = ? ORDER BY id ASC",
    [fingerprint],
  )) {
    details[path] = [detailValue, proof];
  }
  return details;
}

export async function getDetailsMetaMap(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<Record<string, { verified: boolean; verifiedAt: number | null }>> {
  const meta: Record<string, { verified: boolean; verifiedAt: number | null }> = {};
  for (const [path, verified_at, revoked_at] of await db.query<[string, number | string | bigint | null, number | string | bigint | null]>(
    "SELECT path, verified_at, revoked_at FROM details WHERE identity_fingerprint = ? ORDER BY id ASC",
    [fingerprint],
  )) {
    const verifiedAt = coerceNumber(verified_at);
    const revokedAt = coerceNumber(revoked_at);
    meta[path] = { verified: verifiedAt !== null && revokedAt === null, verifiedAt };
  }
  return meta;
}

export async function getAllDetailsMap(db: DatabaseAdapter): Promise<AllDetailsMap> {
  const detailsByIdentity: AllDetailsMap = {};
  for (const [identityFingerprint, path, detail, proof] of await db.query<[string, string, string, string]>(
    "SELECT identity_fingerprint, path, detail, proof FROM details ORDER BY id ASC",
  )) {
    if (!detailsByIdentity[identityFingerprint]) {
      detailsByIdentity[identityFingerprint] = {};
    }
    detailsByIdentity[identityFingerprint][path] = [detail, proof];
  }
  return detailsByIdentity;
}

export async function ensureNewNonce(db: DatabaseAdapter, fingerprint: string, nonce: number): Promise<{ ok: true } | { ok: false; error: string }> {
  let maxNonce = -1;
  for (const [proof] of await db.query<[string]>(
    "SELECT proof FROM details WHERE identity_fingerprint = ?",
    [fingerprint],
  )) {
    try {
      const decoded = hexToBytes(proof);
      const record = JSON.parse(textDecoder.decode(decoded)) as { nonce?: number };
      if (typeof record.nonce === "number") {
        if (record.nonce === nonce) {
          return { ok: false, error: "nonce already used" };
        }
        if (record.nonce > maxNonce) {
          maxNonce = record.nonce;
        }
      }
    } catch {
      // Ignore malformed historical records; they will cause proof validation failure elsewhere.
    }
  }

  if (nonce <= maxNonce) {
    return { ok: false, error: "nonce must be increasing" };
  }

  return { ok: true };
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
    [record.fingerprint, record.type, record.target, record.nonce, record.certificate, record.createdAt],
  );
}

export async function getMaxRevocationNonce(db: DatabaseAdapter, fingerprint: string): Promise<number> {
  let maxNonce = -1;
  for (const [nonce] of await db.query<[number | string | bigint]>(
    "SELECT nonce FROM revocations WHERE identity_fingerprint = ?",
    [fingerprint],
  )) {
    const parsedNonce = coerceNumber(nonce);
    if (parsedNonce !== null && parsedNonce > maxNonce) {
      maxNonce = parsedNonce;
    }
  }
  return maxNonce;
}

export async function hasRevocationWithNonce(db: DatabaseAdapter, fingerprint: string, nonce: number): Promise<boolean> {
  const rows = await db.query<[number]>(
    "SELECT 1 FROM revocations WHERE identity_fingerprint = ? AND nonce = ?",
    [fingerprint, nonce],
  );
  return rows.length > 0;
}

export async function revokeIdentity(db: DatabaseAdapter, fingerprint: string, certificate: string, revokedAt: number): Promise<void> {
  await db.query(
    `UPDATE identities SET revoked_at = ?, revocation_certificate = ? WHERE fingerprint = ?`,
    [revokedAt, certificate, fingerprint],
  );
}

export async function revokeDetail(db: DatabaseAdapter, fingerprint: string, path: string, certificate: string, revokedAt: number): Promise<void> {
  await db.query(
    `UPDATE details
     SET revoked_at = ?, revocation_certificate = ?,
         verified_at = NULL, verification_token = NULL, verification_token_hash = NULL,
         verification_expires_at = NULL, verification_sent_at = NULL
     WHERE identity_fingerprint = ? AND path = ?`,
    [revokedAt, certificate, fingerprint, path],
  );
}

export async function isIdentityRevoked(db: DatabaseAdapter, fingerprint: string): Promise<boolean> {
  const rows = await db.query<[number | string | bigint | null]>(
    "SELECT revoked_at FROM identities WHERE fingerprint = ?",
    [fingerprint],
  );
  const revokedAt = rows.length > 0 ? coerceNumber(rows[0][0]) : null;
  return revokedAt !== null;
}

export async function isDetailRevoked(db: DatabaseAdapter, fingerprint: string, path: string): Promise<boolean> {
  const rows = await db.query<[number | string | bigint | null]>(
    "SELECT revoked_at FROM details WHERE identity_fingerprint = ? AND path = ?",
    [fingerprint, path],
  );
  const revokedAt = rows.length > 0 ? coerceNumber(rows[0][0]) : null;
  return revokedAt !== null;
}

export async function getRevocations(db: DatabaseAdapter, fingerprint: string): Promise<RevocationRow[]> {
  const rows: RevocationRow[] = [];
  for (const [id, identityFp, type, target, nonce, certificate, createdAt] of await db.query<[number | string | bigint, string, string, string | null, number | string | bigint, string, number | string | bigint]>(
    "SELECT id, identity_fingerprint, type, target, nonce, certificate, created_at FROM revocations WHERE identity_fingerprint = ? ORDER BY nonce ASC",
    [fingerprint],
  )) {
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

export async function getRevokedDetailPaths(db: DatabaseAdapter, fingerprint: string): Promise<string[]> {
  const paths: string[] = [];
  for (const [path] of await db.query<[string]>(
    "SELECT path FROM details WHERE identity_fingerprint = ? AND revoked_at IS NOT NULL",
    [fingerprint],
  )) {
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
}): Promise<void> {
  await db.query(
    `INSERT INTO pending_hierarchy_proposals (
       master_fingerprint, child_fingerprint, proposer_fingerprint, certificate, context, expiry, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
  const [rowId, master, child, proposer, certificate, context, expiry, createdAt] = rows[0];
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
    const [id, master, child, proposer, certificate, context, expiry, createdAt] of await db.query<[
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
  const [id, master, child, proposer, certificate, context, expiry, createdAt] = rows[0];
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

export async function deletePendingProposal(db: DatabaseAdapter, id: number): Promise<void> {
  await db.query("DELETE FROM pending_hierarchy_proposals WHERE id = ?", [id]);
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
  const like = `%${query.toLowerCase()}%`;

  const baseJoin =
    "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email')";
  const matchClause = "(LOWER(i.fingerprint) LIKE ? OR LOWER(d.detail) LIKE ?)";
  const revokedFilter = includeRevoked
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

  const countQuery = `SELECT COUNT(DISTINCT i.fingerprint) ${baseJoin} WHERE ${matchClause} ${revokedFilter}`;
  const totalRows = await db.query<[number | string | bigint]>(countQuery, [like, like]);
  const total = coerceNumber(totalRows[0]?.[0] ?? null) ?? 0;

  const listQuery =
    `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at ` +
    `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT ? OFFSET ?`;
  const rows = await db.query<[string, string, string, number | string | bigint]>(listQuery, [like, like, limit, offset]);
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