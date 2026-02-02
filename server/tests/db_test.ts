import { assertEquals, assertFalse, assert } from "jsr:@std/assert@^1.0.6";
import { insertDetail, insertIdentity, ensureNewNonce, initDb } from "../db.ts";
import { encodeProof, createSphincsIdentity } from "./helpers.ts";

async function withTempDb(fn: (dbPath: string) => Promise<void>) {
  const path = Deno.makeTempFileSync({ suffix: ".sqlite" });
  try {
    await fn(path);
  } finally {
    try {
      Deno.removeSync(path);
    } catch {
      // ignore cleanup failures
    }
  }
}

Deno.test("ensureNewNonce allows increasing nonces and rejects reuse", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const { identity } = createSphincsIdentity();

    try {
      await insertIdentity(db, {
        fingerprint: identity.fingerprint,
        signingKeyType: identity.signing_key_type,
        encryptionKeyType: identity.encryption_key_type,
        signingKey: identity.signing_key,
        encryptionKey: identity.encryption_key,
        signingKeyDetails: identity.signing_key_details,
        encryptionKeyDetails: identity.encryption_key_details,
        createdAt: identity.created_at,
      });

      const first = await ensureNewNonce(db, identity.fingerprint, 0);
      assert(first.ok);

      await insertDetail(db, {
        fingerprint: identity.fingerprint,
        path: "profile/name",
        detail: "alice",
        proof: encodeProof({
          nonce: 0,
          path: "profile/name",
          detail: "alice",
          timestamp: Date.now(),
          signature: "sig",
        }),
        createdAt: Date.now(),
      });

      const reused = await ensureNewNonce(db, identity.fingerprint, 0);
      assertFalse(reused.ok);
      assertEquals(reused.error, "nonce already used");

      const lower = await ensureNewNonce(db, identity.fingerprint, -1);
      assertFalse(lower.ok);
      assertEquals(lower.error, "nonce must be increasing");

      const higher = await ensureNewNonce(db, identity.fingerprint, 1);
      assert(higher.ok);
    } finally {
      await db.close();
    }
  });
});

