import { assertEquals, assert } from "jsr:@std/assert@^1.0.6";
import { initDb, insertIdentity, insertDetail, searchIdentities } from "../db/index.ts";
import { createSphincsIdentity, createSignedProof } from "./helpers.ts";

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

Deno.test("searchIdentities: empty query returns all identities", async () => {
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

      // Empty query matches everything via LIKE '%%'
      const { results, total } = await searchIdentities(db, "");
      assertEquals(total, 1);
      assertEquals(results.length, 1);
      assertEquals(results[0].fingerprint, identity.fingerprint);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: finds identity by fingerprint prefix", async () => {
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

      // Search by first 8 characters of fingerprint
      const prefix = identity.fingerprint.substring(0, 8);
      const { results, total } = await searchIdentities(db, prefix);
      assertEquals(total, 1);
      assertEquals(results.length, 1);
      assertEquals(results[0].fingerprint, identity.fingerprint);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: finds identity by name detail", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const { identity, signingKey } = createSphincsIdentity();

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

      // Add name detail
      const { proof } = createSignedProof(signingKey, {
        nonce: 0,
        path: "name",
        detail: "Alice Wonderland",
        timestamp: Date.now(),
      });
      await insertDetail(db, {
        fingerprint: identity.fingerprint,
        path: "name",
        detail: "Alice Wonderland",
        proof,
        createdAt: Date.now(),
      });

      // Search by name (case insensitive)
      const { results, total } = await searchIdentities(db, "alice");
      assertEquals(total, 1);
      assertEquals(results.length, 1);
      assertEquals(results[0].fingerprint, identity.fingerprint);

      // Also works with different case
      const { results: results2 } = await searchIdentities(db, "ALICE");
      assertEquals(results2.length, 1);

      // Partial match
      const { results: results3 } = await searchIdentities(db, "wonder");
      assertEquals(results3.length, 1);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: finds identity by email detail", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const { identity, signingKey } = createSphincsIdentity();

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

      // Add email detail
      const { proof } = createSignedProof(signingKey, {
        nonce: 0,
        path: "email",
        detail: "alice@example.com",
        timestamp: Date.now(),
      });
      await insertDetail(db, {
        fingerprint: identity.fingerprint,
        path: "email",
        detail: "alice@example.com",
        proof,
        createdAt: Date.now(),
      });

      // Search by email domain
      const { results, total } = await searchIdentities(db, "example.com");
      assertEquals(total, 1);
      assertEquals(results.length, 1);

      // Search by email username
      const { results: results2 } = await searchIdentities(db, "alice@");
      assertEquals(results2.length, 1);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: no match returns empty results", async () => {
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

      // Search for something that doesn't exist
      const { results, total } = await searchIdentities(db, "nonexistent12345");
      assertEquals(total, 0);
      assertEquals(results.length, 0);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: pagination works correctly", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const fingerprints: string[] = [];

    try {
      // Create 8 identities with searchable names
      for (let i = 0; i < 8; i++) {
        const { identity, signingKey } = createSphincsIdentity();
        await insertIdentity(db, {
          fingerprint: identity.fingerprint,
          signingKeyType: identity.signing_key_type,
          encryptionKeyType: identity.encryption_key_type,
          signingKey: identity.signing_key,
          encryptionKey: identity.encryption_key,
          signingKeyDetails: identity.signing_key_details,
          encryptionKeyDetails: identity.encryption_key_details,
          createdAt: identity.created_at + i, // Ensure ordering
        });
        fingerprints.push(identity.fingerprint);

        // Add a searchable name detail
        const { proof } = createSignedProof(signingKey, {
          nonce: 0,
          path: "name",
          detail: `TestUser${i}`,
          timestamp: Date.now(),
        });
        await insertDetail(db, {
          fingerprint: identity.fingerprint,
          path: "name",
          detail: `TestUser${i}`,
          proof,
          createdAt: Date.now(),
        });
      }

      // Page 1 with limit 3
      const page1 = await searchIdentities(db, "testuser", { page: 1, limit: 3 });
      assertEquals(page1.total, 8);
      assertEquals(page1.results.length, 3);

      // Page 2
      const page2 = await searchIdentities(db, "testuser", { page: 2, limit: 3 });
      assertEquals(page2.total, 8);
      assertEquals(page2.results.length, 3);

      // Page 3 (partial - only 2 remaining)
      const page3 = await searchIdentities(db, "testuser", { page: 3, limit: 3 });
      assertEquals(page3.total, 8);
      assertEquals(page3.results.length, 2);

      // Page 4 (empty)
      const page4 = await searchIdentities(db, "testuser", { page: 4, limit: 3 });
      assertEquals(page4.total, 8);
      assertEquals(page4.results.length, 0);

      // Ensure no duplicates across pages
      const allFingerprints = [
        ...page1.results.map((r) => r.fingerprint),
        ...page2.results.map((r) => r.fingerprint),
        ...page3.results.map((r) => r.fingerprint),
      ];
      const uniqueFingerprints = new Set(allFingerprints);
      assertEquals(uniqueFingerprints.size, 8);
    } finally {
      await db.close();
    }
  });
});

Deno.test("searchIdentities: does not search other detail paths", async () => {
  await withTempDb(async (dbPath) => {
    const db = await initDb(dbPath);
    const { identity, signingKey } = createSphincsIdentity();

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

      // Add a detail with a different path (not name or email)
      const { proof } = createSignedProof(signingKey, {
        nonce: 0,
        path: "phone",
        detail: "555-1234",
        timestamp: Date.now(),
      });
      await insertDetail(db, {
        fingerprint: identity.fingerprint,
        path: "phone",
        detail: "555-1234",
        proof,
        createdAt: Date.now(),
      });

      // Should not find by phone number (only name/email are searched)
      const { results, total } = await searchIdentities(db, "555-1234");
      assertEquals(total, 0);
      assertEquals(results.length, 0);
    } finally {
      await db.close();
    }
  });
});
