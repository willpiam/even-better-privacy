import { loadSync } from "std/dotenv";
import { Pool } from "postgres";
import { DatabaseAdapter, type DatabaseQueryParams } from "./adapter.ts";

let envLoaded = false;

export function loadEnvOnce(): void {
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
