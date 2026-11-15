import { assertEquals, assertRejects } from "@std/assert";
import { Identity } from "../../core/Identity.ts";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import {
  DatabaseAdapter,
  type DatabaseQueryParams,
  getRevocations,
  insertIdentity,
  isIdentityRevoked,
  PostgresDatabaseAdapter,
} from "../db/index.ts";
import { handlePostDetail } from "../handlers/identity.ts";
import { handlePostRevocation } from "../handlers/revocation.ts";

// Opt into PostgreSQL with IDENTITY_TEST_POSTGRES=true and the usual PG_* settings.
async function mutationDb(): Promise<DatabaseAdapter> {
  if (Deno.env.get("IDENTITY_TEST_POSTGRES") !== "true") {
    return new SqliteDatabaseAdapter(":memory:");
  }
  const db = PostgresDatabaseAdapter.createFromEnv();
  await db.initializeSchema();
  return db;
}

async function cleanup(
  db: DatabaseAdapter,
  fingerprint: string,
): Promise<void> {
  try {
    await db.query("DELETE FROM revocations WHERE identity_fingerprint = ?", [
      fingerprint,
    ]);
    await db.query("DELETE FROM details WHERE identity_fingerprint = ?", [
      fingerprint,
    ]);
    await db.query("DELETE FROM identities WHERE fingerprint = ?", [
      fingerprint,
    ]);
  } finally {
    await db.close();
  }
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/v1/probe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Fail the second write inside a real transaction, after the certificate was inserted. */
class FailRevocationUpdate extends DatabaseAdapter {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly table: string,
  ) {
    super();
  }
  execute(sql: string) {
    return this.db.execute(sql);
  }
  query<T extends unknown[]>(sql: string, params?: DatabaseQueryParams) {
    return this.db.query<T>(sql, params);
  }
  close() {
    return this.db.close();
  }
  writeTransaction<T>(
    operation: (db: DatabaseAdapter) => Promise<T>,
    identityFingerprint?: string,
  ): Promise<T> {
    return this.db.writeTransaction(async (scope) => {
      const wrapped = new FailRevocationUpdate(scope, this.table);
      wrapped.query = <R extends unknown[]>(
        sql: string,
        params?: DatabaseQueryParams,
      ): Promise<R[]> => {
        if (sql.includes(`UPDATE ${this.table}`)) {
          throw new Error("injected update failure");
        }
        return scope.query<R>(sql, params);
      };
      return await operation(wrapped);
    }, identityFingerprint);
  }
}

for (const type of ["identity", "detail"] as const) {
  Deno.test(`revocation ${type}: rollback on failure and idempotent retries`, async () => {
    const db = await mutationDb();
    const identity = new Identity("dilithium", "kyber");
    const fingerprint = identity.toFingerprint();
    try {
      await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
      identity.attachDetail("name", "Alice");
      assertEquals(
        (await handlePostDetail(
          request({
            fingerprint,
            path: "name",
            detail: "Alice",
            proof: identity.details.get("name")![1],
          }),
          db,
        )).status,
        200,
      );
      const certificate = type === "identity"
        ? identity.createIdentityRevocation()
        : identity.revokeDetail("name");
      const payload = {
        fingerprint,
        type,
        target: type === "detail" ? "name" : undefined,
        certificate,
      };
      await assertRejects(
        () =>
          handlePostRevocation(
            request(payload),
            new FailRevocationUpdate(
              db,
              type === "identity" ? "identities" : "details",
            ),
          ),
        Error,
        "injected update failure",
      );
      assertEquals((await getRevocations(db, fingerprint)).length, 0);
      assertEquals(await isIdentityRevoked(db, fingerprint), false);
      const responses = await Promise.all([
        handlePostRevocation(request(payload), db),
        handlePostRevocation(request(payload), db),
      ]);
      assertEquals(responses.map((r) => r.status), [200, 200]);
      assertEquals((await getRevocations(db, fingerprint)).length, 1);
    } finally {
      await cleanup(db, fingerprint);
    }
  });
}

Deno.test("concurrent details cannot commit the same nonce on different paths", async () => {
  const db = await mutationDb();
  const identity = new Identity("dilithium", "kyber");
  const fingerprint = identity.toFingerprint();
  try {
    await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
    const copy = Identity.fromJSON(identity.toJSON());
    const requests = [identity, copy].map((sender, index) => {
      const path = `name${index}`;
      sender.attachDetail(path, "Alice");
      return request({
        fingerprint: sender.toFingerprint(),
        path,
        detail: "Alice",
        proof: sender.details.get(path)![1],
      });
    });
    const responses = await Promise.all(
      requests.map((req) => handlePostDetail(req, db)),
    );
    assertEquals(responses.map((r) => r.status).sort(), [200, 400]);
    assertEquals(
      (await db.query(
        "SELECT path FROM details WHERE identity_fingerprint = ?",
        [fingerprint],
      )).length,
      1,
    );
  } finally {
    await cleanup(db, fingerprint);
  }
});

Deno.test("legacy detail nonces are migrated without losing large values or revoked history", async () => {
  const path = await Deno.makeTempFile({ suffix: ".sqlite" });
  const { insertDetail, ensureNewNonce, revokeDetail, updateDetail } =
    await import("../db/index.ts");
  const { stringToHex } = await import("../../core/Hex.ts");
  let db = new SqliteDatabaseAdapter(path);
  try {
    const identity = new Identity("dilithium", "kyber");
    const fingerprint = identity.toFingerprint();
    await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
    const nonce = 2 ** 32 + 3;
    const proof = stringToHex(JSON.stringify({ nonce }));
    await insertDetail(db, {
      fingerprint,
      path: "name",
      detail: "Alice",
      proof,
      createdAt: Date.now(),
    });
    await revokeDetail(db, fingerprint, "name", "certificate", Date.now());
    // Recreate the schema that existed before numeric nonces were stored.
    await db.execute("DROP INDEX detail_nonce_lookup");
    await db.execute("ALTER TABLE details DROP COLUMN proof_nonce");
    await db.close();
    db = new SqliteDatabaseAdapter(path);
    assertEquals((await ensureNewNonce(db, fingerprint, nonce)).ok, false);
    assertEquals((await ensureNewNonce(db, fingerprint, nonce + 1)).ok, true);
    await updateDetail(db, {
      fingerprint,
      path: "name",
      detail: "Bob",
      proof: stringToHex(JSON.stringify({ nonce: nonce + 1 })),
      createdAt: Date.now(),
    });
    assertEquals((await ensureNewNonce(db, fingerprint, nonce + 1)).ok, false);
    assertEquals((await ensureNewNonce(db, fingerprint, nonce + 2)).ok, true);
  } finally {
    await db.close();
    await Deno.remove(path);
  }
});

Deno.test({
  name:
    "PostgreSQL backfills legacy detail nonces without narrowing large integers",
  ignore: Deno.env.get("IDENTITY_TEST_POSTGRES") !== "true",
  async fn() {
    const db = await mutationDb();
    const identity = new Identity("dilithium", "kyber");
    const fingerprint = identity.toFingerprint();
    try {
      const { insertDetail, ensureNewNonce } = await import("../db/index.ts");
      const { stringToHex } = await import("../../core/Hex.ts");
      await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
      const nonce = 2 ** 32 + 3;
      await insertDetail(db, {
        fingerprint,
        path: "name",
        detail: "Alice",
        proof: stringToHex(JSON.stringify({ nonce })),
        createdAt: Date.now(),
      });
      await db.query(
        "UPDATE details SET proof_nonce = NULL WHERE identity_fingerprint = ?",
        [fingerprint],
      );
      const reopened = await mutationDb();
      try {
        assertEquals(
          (await ensureNewNonce(reopened, fingerprint, nonce)).ok,
          false,
        );
        assertEquals(
          (await ensureNewNonce(reopened, fingerprint, nonce + 1)).ok,
          true,
        );
      } finally {
        await reopened.close();
      }
    } finally {
      await cleanup(db, fingerprint);
    }
  },
});
