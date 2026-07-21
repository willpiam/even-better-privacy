import { Database } from "sqlite";
import { DatabaseAdapter, type DatabaseQueryParams } from "./adapter.ts";

export class SqliteDatabaseAdapter extends DatabaseAdapter {
  private db: Database;

  constructor(path: string) {
    super();
    this.db = new Database(path);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.initializeSchema();
  }

  execute(sql: string): Promise<void> {
    this.db.exec(sql);
    return Promise.resolve();
  }

  query<T extends unknown[]>(
    sql: string,
    params: DatabaseQueryParams = [],
  ): Promise<T[]> {
    const stmt = this.db.prepare(sql);
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
    this.db.close();
    return Promise.resolve();
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

    // Add revocation columns to existing tables if they don't exist (migration)
    try {
      this.db.exec(`ALTER TABLE identities ADD COLUMN revoked_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        `ALTER TABLE identities ADD COLUMN revocation_certificate TEXT`,
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(`ALTER TABLE details ADD COLUMN revoked_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        `ALTER TABLE details ADD COLUMN revocation_certificate TEXT`,
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(`ALTER TABLE details ADD COLUMN verified_at INTEGER`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(`ALTER TABLE details ADD COLUMN verification_token TEXT`);
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        `ALTER TABLE details ADD COLUMN verification_token_hash TEXT`,
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        `ALTER TABLE details ADD COLUMN verification_expires_at INTEGER`,
      );
    } catch {
      /* column already exists */
    }
    try {
      this.db.exec(
        `ALTER TABLE details ADD COLUMN verification_sent_at INTEGER`,
      );
    } catch {
      /* column already exists */
    }
  }
}
