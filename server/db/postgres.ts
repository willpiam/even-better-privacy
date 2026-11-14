import { loadSync } from "std/dotenv";
import { Pool, type PoolClient } from "postgres";
import { DatabaseAdapter, type DatabaseQueryParams } from "./adapter.ts";

/** Dead or reset connections should open a new pool instead of failing every request. */
export function isTransientDbError(err: unknown): boolean {
  const name = err && typeof err === "object" && "name" in err
    ? String((err as { name?: unknown }).name ?? "")
    : "";
  if (name === "ConnectionError") return true;
  const code = err && typeof err === "object" && "fields" in err
    ? String((err as { fields?: { code?: unknown } }).fields?.code ?? "")
    : "";
  if (code.startsWith("08") || code === "57P01" || code === "57P02" || code === "57P03") {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /connection|ECONN|timed out|timeout|closed|terminated|broken pipe|EOF|reset by peer/i
    .test(message);
}

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
    return new PostgresDatabaseAdapter(PostgresDatabaseAdapter.openPool());
  }

  private static openPool(): Pool {
    const hostname = Deno.env.get("PG_HOST") ?? "localhost";
    const port = Number(Deno.env.get("PG_PORT") ?? "5432");
    const user = Deno.env.get("PG_USER") ?? "postgres";
    const password = Deno.env.get("PG_PASSWORD") ?? "";
    const database = Deno.env.get("PG_DATABASE") ?? "postgres";
    const poolSize = Number(Deno.env.get("PG_POOL_SIZE") ?? "5");
    return new Pool({
      hostname,
      port,
      user,
      password,
      database,
    }, poolSize, true);
  }

  private async replacePool(): Promise<void> {
    const previous = this.pool;
    this.pool = PostgresDatabaseAdapter.openPool();
    try {
      await previous.end();
    } catch {
      // The previous pool is already unusable.
    }
  }

  private async withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      let client: PoolClient | undefined;
      try {
        client = await this.pool.connect();
        const result = await run(client);
        client.release();
        return result;
      } catch (err) {
        lastError = err;
        const transient = isTransientDbError(err);
        if (client) {
          if (transient) {
            try {
              await client.end();
            } catch {
              // already closed
            }
          } else {
            client.release();
          }
        }
        if (attempt === 0 && transient) {
          await this.replacePool();
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("database connection failed");
  }

  async execute(sql: string): Promise<void> {
    await this.withClient((client) => client.queryArray(sql));
  }

  async query<T extends unknown[]>(sql: string, params: DatabaseQueryParams = []): Promise<T[]> {
    return await this.withClient(async (client) => {
      const { sql: rewrittenSql, params: rewrittenParams } = this.rewriteSql(sql, params);
      const result = await client.queryArray(rewrittenSql, rewrittenParams);
      return result.rows as T[];
    });
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

    await this.execute(`
      CREATE TABLE IF NOT EXISTS mailboxes (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL UNIQUE,
        stalwart_id TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at BIGINT NOT NULL,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(username, domain)
      )
    `);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS mail_payment_orders (
        order_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL REFERENCES identities(fingerprint),
        proof_nonce BIGINT NOT NULL,
        asset TEXT NOT NULL,
        network TEXT NOT NULL,
        recipient TEXT NOT NULL,
        asset_unit TEXT NOT NULL,
        usd_cents BIGINT NOT NULL,
        amount_atomic TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        usd_per_token TEXT NOT NULL,
        confirmations INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        grace_until BIGINT NOT NULL,
        transaction_id TEXT,
        last_checked BIGINT NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )
    `);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_active_name
      ON mail_payment_orders (username, domain) WHERE active = 1`);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_proof_nonce
      ON mail_payment_orders (identity_fingerprint, proof_nonce)`);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_active_identity
      ON mail_payment_orders (identity_fingerprint) WHERE active = 1`);
    await this.execute(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_transaction
      ON mail_payment_orders (network, transaction_id) WHERE transaction_id IS NOT NULL`);

    await this.execute(`
      CREATE TABLE IF NOT EXISTS retired_mail_usernames (
        id BIGSERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL,
        retired_at BIGINT NOT NULL,
        UNIQUE(username, domain)
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
