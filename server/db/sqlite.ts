import { detailProofNonce } from "./detail-nonces.ts";
import { Database } from "sqlite";
import { DatabaseAdapter, type DatabaseQueryParams } from "./adapter.ts";
import { KeyedQueue } from "../../common/KeyedQueue.ts";
import { PAYMENT_ORDER_SCHEMA_UPDATES } from "./payment-schema.ts";

export class SqliteDatabaseAdapter extends DatabaseAdapter {
  private db: Database;
  private readonly operations = new KeyedQueue();

  constructor(path: string) {
    super();
    this.db = new Database(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initializeSchema();
  }

  execute(sql: string): Promise<void> {
    return this.operations.run("connection", () => {
      this.db.exec(sql);
      return Promise.resolve();
    });
  }

  query<T extends unknown[]>(
    sql: string,
    params: DatabaseQueryParams = [],
  ): Promise<T[]> {
    return this.operations.run(
      "connection",
      () => this.queryDirect<T>(sql, params),
    );
  }

  private queryDirect<T extends unknown[]>(
    sql: string,
    params: DatabaseQueryParams = [],
  ): Promise<T[]> {
    // Return safe integers as numbers and larger values as bigint, never int32.
    const stmt = this.db.prepare(sql).enableInt64();
    const bound = Array.isArray(params)
      ? params.map((value) => {
        // @db/sqlite truncates JS numbers/BigInts to 32-bit on bind/read.
        // Binding large integers as decimal strings preserves full INTEGER values.
        if (
          typeof value === "number" &&
          Number.isInteger(value) &&
          (value > 0x7fffffff || value < -0x80000000)
        ) {
          return String(value);
        }
        if (typeof value === "bigint") {
          return value.toString();
        }
        return value;
      })
      : params;
    return Promise.resolve(stmt.values<T>(bound as never));
  }

  close(): Promise<void> {
    return this.operations.run("connection", () => {
      this.db.close();
      return Promise.resolve();
    });
  }

  writeTransaction<T>(
    operation: (db: DatabaseAdapter) => Promise<T>,
    _resource?: string,
  ): Promise<T> {
    return this.operations.run("connection", async () => {
      this.db.exec("BEGIN IMMEDIATE");
      const scope: DatabaseAdapter = {
        execute: (sql) => {
          this.db.exec(sql);
          return Promise.resolve();
        },
        query: (sql, params) => this.queryDirect(sql, params),
        close: () =>
          Promise.reject(new Error("Cannot close a transaction connection")),
        writeTransaction: () =>
          Promise.reject(new Error("Nested transactions are unsupported")),
      };
      try {
        const result = await operation(scope);
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }

  private initializeSchema(): void {
    this.db.exec(`
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

    this.db.exec(`CREATE TABLE IF NOT EXISTS authorization_nonces (
      identity_fingerprint TEXT PRIMARY KEY, nonce INTEGER NOT NULL)`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS verification_recipient_budget (
      recipient_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL, sent_count INTEGER NOT NULL)`);

    this.db.exec(`
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

    // Protect schema upgrades from other processes opening the same database.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Upgrade existing databases once, retaining nonces on revoked details.
      const columns = this.db.prepare("PRAGMA table_info(details)").values<
        [number, string]
      >();
      if (!columns.some((column) => column[1] === "proof_nonce")) {
        this.db.exec("ALTER TABLE details ADD COLUMN proof_nonce INTEGER");
      }
      for (
        const [id, proof] of this.db.prepare(
          "SELECT CAST(id AS TEXT), proof FROM details WHERE proof_nonce IS NULL",
        ).values<[string, string]>()
      ) {
        const nonce = detailProofNonce(proof);
        if (nonce !== null) {
          this.db.prepare("UPDATE details SET proof_nonce = ? WHERE id = ?")
            .run(
              nonce > 0x7fffffff ? String(nonce) : nonce,
              id,
            );
        }
      }
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS detail_nonce_lookup ON details(identity_fingerprint, proof_nonce)",
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }

    this.db.exec("CREATE INDEX IF NOT EXISTS verified_email_lookup ON details(LOWER(TRIM(detail))) WHERE path = 'email' AND verified_at IS NOT NULL AND revoked_at IS NULL");

    this.db.exec(`
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

    this.db.exec(`
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

    this.db.exec(`CREATE INDEX IF NOT EXISTS hierarchy_master_idx
      ON hierarchy_certificates (master_fingerprint)`);

    this.db.exec(`
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

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mailboxes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL UNIQUE,
        stalwart_id TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(identity_fingerprint) REFERENCES identities(fingerprint),
        UNIQUE(username, domain)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_payment_orders (
        order_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL REFERENCES identities(fingerprint),
        proof_nonce INTEGER NOT NULL,
        asset TEXT NOT NULL,
        network TEXT NOT NULL,
        recipient TEXT NOT NULL,
        asset_unit TEXT NOT NULL,
        usd_cents INTEGER NOT NULL,
        amount_atomic TEXT NOT NULL,
        decimals INTEGER NOT NULL,
        usd_per_token TEXT NOT NULL,
        confirmations INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        grace_until INTEGER NOT NULL,
        transaction_id TEXT,
        cancelled_at INTEGER,
        last_checked INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )
    `);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const columns = this.db.prepare("PRAGMA table_info(mail_payment_orders)").values<[number, string]>();
      if (!columns.some(([, name]) => name === "cancelled_at")) {
        this.db.exec("ALTER TABLE mail_payment_orders ADD COLUMN cancelled_at INTEGER");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_active_name
      ON mail_payment_orders (username, domain) WHERE active = 1`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_proof_nonce
      ON mail_payment_orders (identity_fingerprint, proof_nonce)`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_active_identity
      ON mail_payment_orders (identity_fingerprint) WHERE active = 1`);
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS mail_payment_transaction
      ON mail_payment_orders (network, transaction_id) WHERE transaction_id IS NOT NULL`);
    for (const sql of PAYMENT_ORDER_SCHEMA_UPDATES) this.db.exec(sql);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS retired_mail_usernames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        domain TEXT NOT NULL,
        identity_fingerprint TEXT NOT NULL,
        retired_at INTEGER NOT NULL,
        UNIQUE(username, domain)
      )
    `);
  }
}
