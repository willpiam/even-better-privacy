import { DB } from "sqlite";
import type { QueryParameterSet } from "sqlite";
import { DatabaseAdapter, type DatabaseQueryParams } from "./adapter.ts";

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
