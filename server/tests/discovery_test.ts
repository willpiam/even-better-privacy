import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { DatabaseAdapter, type DatabaseQueryParams } from "../db/adapter.ts";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import {
  insertDetail,
  insertIdentity,
  insertRevocation,
  revokeIdentity,
  searchIdentities,
} from "../db/index.ts";
import {
  handleListIdentities,
  handleSearchIdentities,
} from "../handlers/discovery.ts";

class CountingDatabase extends DatabaseAdapter {
  queries = 0;
  constructor(private inner: DatabaseAdapter) {
    super();
  }
  execute(sql: string): Promise<void> {
    return this.inner.execute(sql);
  }
  writeTransaction<T>(operation: (db: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.writeTransaction(operation);
  }
  query<T extends unknown[]>(
    sql: string,
    params?: DatabaseQueryParams,
  ): Promise<T[]> {
    this.queries++;
    return this.inner.query<T>(sql, params);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

const verifiedAt = 1_800_000_000_000;

async function withDiscoveryDb(run: (db: CountingDatabase) => Promise<void>) {
  const db = new CountingDatabase(new SqliteDatabaseAdapter(":memory:"));
  try {
    for (let i = 0; i < 101; i++) {
      const fingerprint = `identity-${i}`;
      await insertIdentity(db, {
        fingerprint,
        signingKeyType: "dilithium",
        encryptionKeyType: "kyber",
        signingKey: "key",
        encryptionKey: "key",
        signingKeyDetails: null,
        encryptionKeyDetails: null,
        createdAt: verifiedAt + i,
      });
      await insertDetail(db, {
        fingerprint,
        path: "name",
        detail: `Match ${i}`,
        proof: "name-proof",
        createdAt: i,
      });
    }
    await insertDetail(db, {
      fingerprint: "identity-0",
      path: "email",
      detail: "retired@example.test",
      proof: "email-proof",
      createdAt: 0,
    });
    await db.query(
      "UPDATE details SET revoked_at = 0 WHERE identity_fingerprint = ? AND path = ?",
      ["identity-0", "email"],
    );
    await db.query(
      "UPDATE details SET verified_at = ? WHERE identity_fingerprint = ? AND path = ?",
      [verifiedAt, "identity-1", "name"],
    );
    await revokeIdentity(db, "identity-100", "identity-revocation", 1);
    await insertRevocation(db, {
      fingerprint: "identity-100",
      type: "identity",
      target: null,
      nonce: 0,
      certificate: "identity-revocation",
      createdAt: 1,
    });
    db.queries = 0;
    await run(db);
  } finally {
    await db.close();
  }
}

Deno.test("list and search hydrate small and large pages with bounded queries and unchanged metadata", async () => {
  await withDiscoveryDb(async (db) => {
    for (const handler of [handleListIdentities, handleSearchIdentities]) {
      for (const limit of [5, 100]) {
        db.queries = 0;
        const res = await handler(
          new URL(`http://localhost/?query=match&limit=${limit}`),
          db,
        );
        const body = await res.json();
        assertEquals(res.status, 200);
        assertEquals(body.identities.length, limit);
        assertEquals(body.identities[0].createdAt, verifiedAt);
        assertEquals(body.pagination.total, 100);
        assert(db.queries <= 3, `page of ${limit} used ${db.queries} queries`);
        assertEquals(body.identities[0].revokedDetails, ["email"]);
        assertEquals(body.identities[0].details.email, undefined);
        assertEquals(body.identities[0].detailsMeta.email, undefined);
        assertEquals(body.identities[1].details.name, [
          "Match 1",
          "name-proof",
        ]);
        assertEquals(body.identities[1].detailsMeta.name, {
          verified: true,
          verifiedAt,
        });
      }
      db.queries = 0;
      const body = await (await handler(
        new URL(
          "http://localhost/?query=match&limit=100&page=2&includeRevoked=true",
        ),
        db,
      )).json();
      assertEquals(body.pagination.total, 101);
      assertEquals(body.identities.length, 1);
      assertEquals(body.identities[0].revoked, true);
      assertEquals(
        body.identities[0].revocationCertificate,
        "identity-revocation",
      );
      assert(db.queries <= 3);

      db.queries = 0;
      const empty = await (await handler(
        new URL("http://localhost/?query=match&page=1000"),
        db,
      )).json();
      assertEquals(empty.identities, []);
      assert(db.queries <= 2);
    }
  });
});

Deno.test("revoked email details cannot match searches even when revoked identities are included", async () => {
  await withDiscoveryDb(async (db) => {
    for (const includeRevoked of [false, true]) {
      const body = await (await handleSearchIdentities(
        new URL(
          `http://localhost/?q=retired%40example.test&includeRevoked=${includeRevoked}`,
        ),
        db,
      )).json();
      assertEquals(body.identities, []);
      assertEquals(body.pagination.total, 0);
    }
    // Fingerprint lookup still finds the identity and advertises the revoked path.
    const body = await (await handleSearchIdentities(
      new URL("http://localhost/?q=identity-0"),
      db,
    )).json();
    assertEquals(body.identities.length, 1);
    assertEquals(body.identities[0].revokedDetails, ["email"]);
    assertEquals(body.identities[0].details.email, undefined);

    const directSearch = await searchIdentities(db, "retired@example.test");
    assertEquals(directSearch.total, 0);
    assertEquals(directSearch.results, []);
  });
});
