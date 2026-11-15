import { assertEquals, assertRejects } from "@std/assert";
import { Identity } from "../../core/Identity.ts";
import {
  type DatabaseAdapter,
  type DatabaseQueryParams,
} from "../db/adapter.ts";
import {
  getDetailRecord,
  getDetailsMap,
  getIdentity,
  getMailboxByFingerprint,
  getRevocations,
  insertIdentity,
  issueDetailVerification,
  updateDetailVerification,
} from "../db/index.ts";
import { handlePostDetail } from "../handlers/identity.ts";
import { handlePostRevocation } from "../handlers/revocation.ts";
import { handleVerifyEmailConfirm } from "../verify-email.ts";
import { computeTokenHash } from "../crypto.ts";
import {
  handleMailSignup,
  setStalwartClientForTests,
} from "../handlers/mail-signup.ts";
import { StalwartClient } from "../stalwart.ts";

const request = (data: unknown) =>
  new Request("https://key.example/api/v1/test", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(data),
  });

function intercept(
  db: DatabaseAdapter,
  query: (
    db: DatabaseAdapter,
    sql: string,
    params?: DatabaseQueryParams,
  ) => Promise<unknown[][]>,
): DatabaseAdapter {
  return {
    execute: db.execute.bind(db),
    close: db.close.bind(db),
    query: async <T extends unknown[]>(
      sql: string,
      params?: DatabaseQueryParams,
    ) => await query(db, sql, params) as T[],
    writeTransaction: (operation, resource) =>
      db.writeTransaction((tx) => operation(intercept(tx, query)), resource),
  };
}

async function seed(db: DatabaseAdapter) {
  const identity = new Identity("dilithium", "kyber");
  await insertIdentity(db, { ...identity.summary, createdAt: Date.now() });
  return identity;
}

async function postDetail(
  db: DatabaseAdapter,
  identity: Identity,
  path: string,
  detail: string,
) {
  identity.attachDetail(path, detail);
  return await handlePostDetail(
    request({
      fingerprint: identity.toFingerprint(),
      path,
      detail,
      proof: identity.details.get(path)![1],
    }),
    db,
  );
}

export function registerStateAtomicityTests(
  createDb: () => Promise<DatabaseAdapter>,
): void {
  Deno.test("mail provisioning cannot commit a stale detail nonce after another writer", async () => {
    const db = await createDb();
    const keys = ["MAIL_SIGNUP_ENABLED", "MAIL_DOMAIN", "MAIL_HOST"];
    const previous = keys.map((key) => Deno.env.get(key));
    try {
      Deno.env.set("MAIL_SIGNUP_ENABLED", "true");
      Deno.env.set("MAIL_DOMAIN", "race.test");
      Deno.env.set("MAIL_HOST", "mail.race.test");
      const identity = await seed(db), fingerprint = identity.toFingerprint();
      const other = Identity.fromJSON(identity.toJSON());
      identity.attachDetail("email", "race-user@race.test");
      let destroyed = false;
      const stalwart = new StalwartClient({
        baseUrl: "https://stalwart.invalid",
        token: "test",
        domainId: "test-domain",
      });
      stalwart.createUser = async () => {
        assertEquals(
          (await postDetail(db, other, "name", "winner")).status,
          200,
        );
        return "provisioned-account";
      };
      stalwart.destroyUser = () => {
        destroyed = true;
        return Promise.resolve();
      };
      setStalwartClientForTests(stalwart);
      const response = await handleMailSignup(
        request({
          fingerprint,
          username: "race-user",
          mailPassword: "x".repeat(32),
          detailProof: identity.details.get("email")![1],
        }),
        db,
      );
      assertEquals(response.status, 409);
      assertEquals(destroyed, true);
      assertEquals(await getDetailRecord(db, fingerprint, "email"), null);
      assertEquals(await getMailboxByFingerprint(db, fingerprint), null);
      assertEquals(Object.keys(await getDetailsMap(db, fingerprint)), ["name"]);
    } finally {
      setStalwartClientForTests(null);
      keys.forEach((key, index) => {
        const value = previous[index];
        if (value === undefined) Deno.env.delete(key);
        else Deno.env.set(key, value);
      });
      await db.close();
    }
  });
  Deno.test("concurrent detail writes enforce one monotonic identity-wide nonce", async () => {
    const db = await createDb();
    try {
      const first = await seed(db), second = Identity.fromJSON(first.toJSON());
      const results = await Promise.all([
        postDetail(db, first, "name", "Alice"),
        postDetail(db, second, "role", "Engineer"),
      ]);
      assertEquals(results.map((r) => r.status).sort(), [200, 400]);
      assertEquals(
        Object.keys(await getDetailsMap(db, first.toFingerprint())).length,
        1,
      );
    } finally {
      await db.close();
    }
  });

  for (const emergency of [false, true]) {
    Deno.test(`${emergency ? "emergency" : "regular"} revocation failure rolls back and the certificate remains usable`, async () => {
      const db = await createDb();
      try {
        const identity = await seed(db), fingerprint = identity.toFingerprint();
        const certificate = emergency
          ? identity.generateEmergencyRevocationCertificate()
          : identity.createIdentityRevocation();
        const payload = { fingerprint, type: "identity", certificate };
        const failing = intercept(db, (connection, sql, params) => {
          if (sql.includes("UPDATE identities SET revoked_at")) {
            throw new Error("injected failure");
          }
          return connection.query(sql, params);
        });
        await assertRejects(
          () => handlePostRevocation(request(payload), failing),
          Error,
          "injected failure",
        );
        assertEquals((await getIdentity(db, fingerprint))!.revoked_at, null);
        assertEquals(await getRevocations(db, fingerprint), []);
        assertEquals(
          (await handlePostRevocation(request(payload), db)).status,
          200,
        );
        assertEquals(
          (await getIdentity(db, fingerprint))!.revoked_at !== null,
          true,
        );
      } finally {
        await db.close();
      }
    });
  }

  Deno.test("revocation of an unpublished detail is rejected without consuming its certificate", async () => {
    const db = await createDb();
    try {
      const identity = await seed(db), fingerprint = identity.toFingerprint();
      identity.attachDetail("name", "Alice");
      const [detail, proof] = identity.details.get("name")!;
      const certificate = identity.revokeDetail("name");
      const payload = {
        fingerprint,
        type: "detail",
        target: "name",
        certificate,
      };
      assertEquals(
        (await handlePostRevocation(request(payload), db)).status,
        404,
      );
      assertEquals(await getRevocations(db, fingerprint), []);
      assertEquals(
        (await handlePostDetail(
          request({ fingerprint, path: "name", detail, proof }),
          db,
        )).status,
        200,
      );
      assertEquals(
        (await handlePostRevocation(request(payload), db)).status,
        200,
      );
      assertEquals(
        (await getDetailRecord(db, fingerprint, "name"))!.revoked_at !== null,
        true,
      );
      assertEquals(
        (await handlePostDetail(
          request({ fingerprint, path: "name", detail, proof }),
          db,
        )).status,
        400,
      );
    } finally {
      await db.close();
    }
  });

  Deno.test("an old email token cannot verify a replacement claim or clear its new token", async () => {
    const db = await createDb();
    try {
      const identity = await seed(db), fingerprint = identity.toFingerprint();
      assertEquals(
        (await postDetail(db, identity, "email", "old@example.test")).status,
        200,
      );
      await updateDetailVerification(db, {
        fingerprint,
        path: "email",
        verifiedAt: null,
        verificationToken: null,
        verificationTokenHash: computeTokenHash("old-token"),
        verificationExpiresAt: Date.now() + 60000,
        verificationSentAt: Date.now(),
      });
      const raced = intercept(db, async (connection, sql, params) => {
        const rows = await connection.query(sql, params);
        if (sql.includes("FROM details WHERE verification_token_hash = ?")) {
          const certificate = identity.revokeDetail("email");
          assertEquals(
            (await handlePostRevocation(
              request({
                fingerprint,
                type: "detail",
                target: "email",
                certificate,
              }),
              db,
            )).status,
            200,
          );
          assertEquals(
            (await postDetail(db, identity, "email", "new@example.test"))
              .status,
            200,
          );
        }
        return rows;
      });
      assertEquals(
        (await handleVerifyEmailConfirm(request({ token: "old-token" }), raced))
          .status,
        409,
      );
      const current = (await getDetailRecord(db, fingerprint, "email"))!;
      assertEquals(current.detail, "new@example.test");
      assertEquals(current.verified_at, null);
      assertEquals(current.verification_token_hash !== null, true);
      assertEquals(
        await issueDetailVerification(db, {
          fingerprint,
          path: "email",
          detail: "old@example.test",
          proof: "stale",
          token: null,
          tokenHash: "wrong",
          expiresAt: Date.now() + 60000,
          sentAt: Date.now(),
        }),
        false,
      );
    } finally {
      await db.close();
    }
  });

  Deno.test("a verification token can be consumed only once", async () => {
    const db = await createDb();
    try {
      const identity = await seed(db), fingerprint = identity.toFingerprint();
      await postDetail(db, identity, "email", "alice@example.test");
      await updateDetailVerification(db, {
        fingerprint,
        path: "email",
        verifiedAt: null,
        verificationToken: null,
        verificationTokenHash: computeTokenHash("one-token"),
        verificationExpiresAt: Date.now() + 60000,
        verificationSentAt: Date.now(),
      });
      const results = await Promise.all(
        [1, 2].map(() =>
          handleVerifyEmailConfirm(request({ token: "one-token" }), db)
        ),
      );
      assertEquals(results.filter((result) => result.status === 200).length, 1);
    } finally {
      await db.close();
    }
  });
}
