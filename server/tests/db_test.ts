import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
} from "jsr:@std/assert@^1.0.6";
import { computeTokenHash } from "../crypto.ts";
import {
  ensureNewNonce,
  getDetailByVerificationToken,
  initDb,
  insertDetail,
  insertIdentity,
  updateDetailVerification,
} from "../db/index.ts";
import { createSphincsIdentity, encodeProof } from "./helpers.ts";

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

Deno.test("sqlite enables foreign-key constraints", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);

    try {
      await assertRejects(() =>
        insertDetail(db, {
          fingerprint: "missing-identity",
          path: "name",
          detail: "orphan",
          proof: "proof",
          createdAt: Date.now(),
        })
      );
    } finally {
      await db.close();
    }
  });
});

Deno.test("plaintext verification token fallback still matches through constant-time comparison path", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const { identity } = createSphincsIdentity();
    const token = "legacy-plaintext-token";

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
      await insertDetail(db, {
        fingerprint: identity.fingerprint,
        path: "email",
        detail: "alice@example.com",
        proof: "proof",
        createdAt: Date.now(),
      });
      await updateDetailVerification(db, {
        fingerprint: identity.fingerprint,
        path: "email",
        verifiedAt: null,
        verificationToken: token,
        verificationTokenHash: null,
        verificationExpiresAt: Date.now() + 60_000,
        verificationSentAt: Date.now(),
      });

      const record = await getDetailByVerificationToken(
        db,
        computeTokenHash("different-token"),
        token,
      );
      assertEquals(record?.fingerprint, identity.fingerprint);
      assertEquals(record?.path, "email");
    } finally {
      await db.close();
    }
  });
});
