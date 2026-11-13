import { assertEquals } from "jsr:@std/assert";
import { Identity } from "../../core/Identity.ts";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { getDetailRecord, insertIdentity } from "../db/index.ts";
import { handlePostDetail } from "../handlers/identity.ts";
import { handlePostRevocation } from "../handlers/revocation.ts";

Deno.test("revoked identities cannot add details or trigger email verification", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  const req = (body: unknown) =>
    new Request("http://localhost/api/v1/probe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const identity = new Identity("dilithium", "kyber");
    const fingerprint = identity.toFingerprint();
    await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
    const certificate = identity.createIdentityRevocation("regression test");
    assertEquals(
      (await handlePostRevocation(
        req({ fingerprint, type: "identity", certificate }),
        db,
      )).status,
      200,
    );
    for (
      const [path, detail] of [["name", "changed after revocation"], [
        "email",
        "probe@example.test",
      ]]
    ) {
      identity.attachDetail(path, detail);
      const proof = identity.details.get(path)![1];
      const response = await handlePostDetail(
        req({ fingerprint, path, detail, proof }),
        db,
      );
      assertEquals(response.status, 400);
      assertEquals((await response.json()).error, "identity is revoked");
      assertEquals(await getDetailRecord(db, fingerprint, path), null);
    }
  } finally {
    await db.close();
  }
});
