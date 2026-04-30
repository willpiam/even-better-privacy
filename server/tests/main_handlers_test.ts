import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import {
  createIdentityPayload,
  createRevocationCertificate,
  createSignedProof,
} from "./helpers.ts";
import {
  buildMessageHashEnvelopeFromHash,
  sha256Hex,
} from "../../core/MessageHash.ts";

function signHashedMessageForTest(
  message: string,
  sign: (message: string) => string,
): { messageHash: string; salt: string; signature: string } {
  const messageHash = sha256Hex(message);
  const salt = "";
  const envelope = buildMessageHashEnvelopeFromHash(messageHash, salt);
  return { messageHash, salt, signature: sign(envelope) };
}

type MainModule = typeof import("../main.ts");

async function withServer(
  fn: (mod: MainModule, dbPath: string) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  // Ensure each test gets a fresh module instance and DB
  Deno.env.set("DB_PATH", dbPath);
  Deno.env.set("EMAIL_VERIFICATION_STORE_PLAINTEXT", "true");
  const mod: MainModule = await import(`../main.ts#${crypto.randomUUID()}`);

  try {
    await fn(mod, dbPath);
  } finally {
    try {
      await mod.closeDb();
    } catch {
      // ignore
    }
    try {
      Deno.removeSync(dbPath);
    } catch {
      // ignore cleanup failures
    }
    Deno.env.delete("DB_PATH");
    Deno.env.delete("EMAIL_VERIFICATION_STORE_PLAINTEXT");
  }
}

async function registerIdentity(mod: MainModule) {
  const { payload, fingerprint, signingKey } = createIdentityPayload();
  const res = await mod.handleRequest(
    new Request("http://localhost/api/v1/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.fingerprint, fingerprint);
  return { fingerprint, signingKey };
}

async function postDetail(
  mod: MainModule,
  fingerprint: string,
  signingKey: {
    sign: (msg: string) => string;
    variant: string;
    publicKey: string;
  },
  path: string,
  detail: string,
  nonce = 0,
) {
  const { proof } = createSignedProof(signingKey, {
    nonce,
    path,
    detail,
    timestamp: Date.now(),
  });

  return await mod.handleRequest(
    new Request("http://localhost/api/v1/detail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint, path, detail, proof }),
    }),
  );
}

async function postVerifySignature(
  mod: MainModule,
  body: Record<string, unknown>,
) {
  return await mod.handleRequest(
    new Request("http://localhost/api/v1/verify-signature", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

Deno.test("POST /identity then GET /identity returns stored record", async () => {
  await withServer(async (mod) => {
    const { fingerprint } = await registerIdentity(mod);

    const res = await mod.handleRequest(
      new Request(`http://localhost/api/v1/identity/${fingerprint}`),
    );
    assertEquals(res.status, 200);
    const body = await res.json();

    assertEquals(body.fingerprint, fingerprint);
    assertEquals(body.details, {});
    assertEquals(body.revoked, false);
  });
});

Deno.test("POST /identity replay returns byte-identical response", async () => {
  await withServer(async (mod) => {
    const { payload } = createIdentityPayload();
    const req = () =>
      new Request("http://localhost/api/v1/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

    const first = await mod.handleRequest(req());
    const second = await mod.handleRequest(req());
    assertEquals(first.status, 200);
    assertEquals(second.status, 200);
    assertEquals(await first.text(), await second.text());
  });
});

Deno.test("POST /detail for unknown identity returns generic bad request", async () => {
  await withServer(async (mod) => {
    const { fingerprint, signingKey } = createIdentityPayload();
    const res = await postDetail(mod, fingerprint, signingKey, "name", "Alice");
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error, "unknown subject");
  });
});

Deno.test("POST /detail stores detail and rejects duplicate path", async () => {
  await withServer(async (mod) => {
    const { fingerprint, signingKey } = await registerIdentity(mod);

    const first = await postDetail(
      mod,
      fingerprint,
      signingKey,
      "name",
      "Alice",
    );
    assertEquals(first.status, 200);
    const firstBody = await first.json();
    assertEquals(firstBody.ok, true);

    const duplicate = await postDetail(
      mod,
      fingerprint,
      signingKey,
      "name",
      "Alice",
      1,
    );
    assertEquals(duplicate.status, 409);

    const identityRes = await mod.handleRequest(
      new Request(`http://localhost/api/v1/identity/${fingerprint}`),
    );
    const identity = await identityRes.json();
    assertEquals(identity.details.name[0], "Alice");
  });
});

Deno.test("Revoked detail rejects old proof but accepts new proof", async () => {
  await withServer(async (mod) => {
    const { fingerprint, signingKey } = await registerIdentity(mod);
    const path = "email";
    const detail = "user@example.com";

    const { proof: oldProof } = createSignedProof(signingKey, {
      nonce: 0,
      path,
      detail,
      timestamp: Date.now(),
    });
    const first = await mod.handleRequest(
      new Request("http://localhost/api/v1/detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint, path, detail, proof: oldProof }),
      }),
    );
    assertEquals(first.status, 200);

    const detailCert = createRevocationCertificate(signingKey, {
      type: "detail",
      fingerprint,
      nonce: 1,
      timestamp: Date.now(),
      reason: "rotate email",
      target: path,
    });
    const revokeRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          type: "detail",
          target: path,
          certificate: detailCert,
        }),
      }),
    );
    assertEquals(revokeRes.status, 200);

    const reuseOld = await mod.handleRequest(
      new Request("http://localhost/api/v1/detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint, path, detail, proof: oldProof }),
      }),
    );
    assertEquals(reuseOld.status, 400);
    const reuseBody = await reuseOld.json();
    assert(String(reuseBody.error ?? "").includes("nonce"));

    const { proof: newProof } = createSignedProof(signingKey, {
      nonce: 1,
      path,
      detail,
      timestamp: Date.now(),
    });
    const readd = await mod.handleRequest(
      new Request("http://localhost/api/v1/detail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint, path, detail, proof: newProof }),
      }),
    );
    assertEquals(readd.status, 200);

    const identityRes = await mod.handleRequest(
      new Request(`http://localhost/api/v1/identity/${fingerprint}`),
    );
    const identity = await identityRes.json();
    assertEquals(identity.details.email[0], detail);
    assertEquals(identity.revokedDetails, []);
  });
});

Deno.test("Email detail is unverified until verification endpoint is called", async () => {
  await withServer(async (mod, _dbPath) => {
    const { fingerprint, signingKey } = await registerIdentity(mod);
    const detailRes = await postDetail(
      mod,
      fingerprint,
      signingKey,
      "email",
      "user@example.com",
      0,
    );
    assertEquals(detailRes.status, 200);

    const db = await mod.getDbForTests();
    const rows = await db.query<
      [number | string | bigint | null, string | null]
    >(
      "SELECT verified_at, verification_token FROM details WHERE identity_fingerprint = ? AND path = ?",
      [fingerprint, "email"],
    );
    assertEquals(rows.length, 1);
    const [verifiedAtRaw, verificationToken] = rows[0];
    assertEquals(verifiedAtRaw, null);
    assert(verificationToken, "verification token should be set");

    const verifyRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/verify-email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "application/json",
        },
        body: JSON.stringify({ token: verificationToken }),
      }),
    );
    assertEquals(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assertEquals(verifyBody.ok, true);

    const refreshedRows = await db.query<
      [number | string | bigint | null, string | null]
    >(
      "SELECT verified_at, verification_token FROM details WHERE identity_fingerprint = ? AND path = ?",
      [fingerprint, "email"],
    );
    assertEquals(refreshedRows.length, 1);
    const [refreshedVerifiedAtRaw, refreshedToken] = refreshedRows[0];
    assert(refreshedVerifiedAtRaw !== null, "email should be marked verified");
    assertEquals(refreshedToken, null);
  });
});

Deno.test("Revocation endpoints revoke details and identities and reflect in listings", async () => {
  await withServer(async (mod) => {
    const { fingerprint, signingKey } = await registerIdentity(mod);

    // Add a detail with nonce 0
    const detailRes = await postDetail(
      mod,
      fingerprint,
      signingKey,
      "email",
      "user@example.com",
      0,
    );
    assertEquals(detailRes.status, 200);

    // Revoke the detail with nonce 1
    const detailCert = createRevocationCertificate(signingKey, {
      type: "detail",
      fingerprint,
      nonce: 1,
      timestamp: Date.now(),
      reason: "replace email",
      target: "email",
    });
    const revokeDetailRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          type: "detail",
          target: "email",
          certificate: detailCert,
        }),
      }),
    );
    assertEquals(revokeDetailRes.status, 200);
    const revokeDetailBody = await revokeDetailRes.json();
    assertEquals(revokeDetailBody.ok, true);

    // Revoke the identity with nonce 2
    const identityCert = createRevocationCertificate(signingKey, {
      type: "identity",
      fingerprint,
      nonce: 2,
      timestamp: Date.now(),
      reason: "compromised",
    });
    const revokeIdentityRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          type: "identity",
          certificate: identityCert,
        }),
      }),
    );
    assertEquals(revokeIdentityRes.status, 200);
    const revokeIdentityBody = await revokeIdentityRes.json();
    assertEquals(revokeIdentityBody.ok, true);

    // Identity view should mark revoked and list revoked detail paths
    // Note: single identity endpoint returns all details but flags which are revoked
    const identityRes = await mod.handleRequest(
      new Request(`http://localhost/api/v1/identity/${fingerprint}`),
    );
    const identity = await identityRes.json();
    assertEquals(identity.revoked, true);
    assertEquals(identity.revokedDetails, ["email"]);
    // The single identity endpoint still returns the detail data (unlike list endpoints)
    assert(identity.details.email, "detail is still present in response");
    assert(
      identity.revocationCertificate,
      "revocation certificate is returned",
    );

    // Revocation listing should include both entries
    const revocationsRes = await mod.handleRequest(
      new Request(`http://localhost/api/v1/revocations/${fingerprint}`),
    );
    const revocationsBody = await revocationsRes.json();
    assertEquals(revocationsBody.revocations.length, 2);

    // Identity list should exclude revoked by default
    const listRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/identities"),
    );
    const listBody = await listRes.json();
    assertEquals(listBody.identities.length, 0);

    // When includeRevoked=true, the revoked identity is returned and flagged
    const listRevokedRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/identities?includeRevoked=true"),
    );
    const listRevokedBody = await listRevokedRes.json();
    assertEquals(listRevokedBody.identities.length, 1);
    assertEquals(listRevokedBody.identities[0].revoked, true);
    assertEquals(listRevokedBody.identities[0].revokedDetails, ["email"]);
  });
});

Deno.test("Search endpoint filters revoked identities unless explicitly included", async () => {
  await withServer(async (mod) => {
    const { fingerprint: activeFp, signingKey: activeKey } =
      await registerIdentity(mod);
    await postDetail(mod, activeFp, activeKey, "name", "Active User", 0);

    const { fingerprint: revokedFp, signingKey: revokedKey } =
      await registerIdentity(mod);
    await postDetail(mod, revokedFp, revokedKey, "name", "Revoked User", 0);
    const revocationCert = createRevocationCertificate(revokedKey, {
      type: "identity",
      fingerprint: revokedFp,
      nonce: 1,
      timestamp: Date.now(),
      reason: "test revoke",
    });
    const revokeRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint: revokedFp,
          type: "identity",
          certificate: revocationCert,
        }),
      }),
    );
    assertEquals(revokeRes.status, 200);

    const searchActiveOnly = await mod.handleRequest(
      new Request("http://localhost/api/v1/identities/search?query=user"),
    );
    const searchActiveOnlyBody = await searchActiveOnly.json();
    assertEquals(searchActiveOnlyBody.identities.length, 1);
    assertEquals(searchActiveOnlyBody.identities[0].fingerprint, activeFp);

    const searchAll = await mod.handleRequest(
      new Request(
        "http://localhost/api/v1/identities/search?query=user&includeRevoked=true",
      ),
    );
    const searchAllBody = await searchAll.json();
    assertEquals(searchAllBody.identities.length, 2);
  });
});

Deno.test("POST /verify-signature verifies signed payload with provided public identity and returns published signer details", async () => {
  await withServer(async (mod) => {
    const { payload, fingerprint, signingKey } = createIdentityPayload();
    const registerRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    assertEquals(registerRes.status, 200);

    const detailRes = await postDetail(
      mod,
      fingerprint,
      signingKey,
      "name",
      "Alice",
      0,
    );
    assertEquals(detailRes.status, 200);

    const message = "hello from test";
    const signed = signHashedMessageForTest(
      message,
      (value) => signingKey.sign(value),
    );
    const verifyRes = await postVerifySignature(mod, {
      payload: {
        type: "ebp-signed-message",
        message,
        messageHash: signed.messageHash,
        salt: signed.salt,
        signature: signed.signature,
        fingerprint,
      },
      publicIdentity: {
        fingerprint,
        signingKeyType: "sphincs",
        signingKey: signingKey.publicKey,
        signingKeyDetails: { variant: signingKey.variant },
        encryptionKeyType: "kyber",
        encryptionKey: payload.encryptionKey,
      },
    });
    assertEquals(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assertEquals(verifyBody.verified, true);
    assertEquals(verifyBody.identityPublished, true);
    assertEquals(verifyBody.fingerprint, fingerprint);
    assertEquals(verifyBody.signer.details.name[0], "Alice");
  });
});

Deno.test("POST /verify-signature verifies detached signature via published identity lookup", async () => {
  await withServer(async (mod) => {
    const { payload, fingerprint, signingKey } = createIdentityPayload();
    const registerRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    assertEquals(registerRes.status, 200);

    const message = "detached payload message";
    const signed = signHashedMessageForTest(
      message,
      (value) => signingKey.sign(value),
    );
    const verifyRes = await postVerifySignature(mod, {
      payload: {
        type: "ebp-signature",
        messageHash: signed.messageHash,
        salt: signed.salt,
        signature: signed.signature,
        fingerprint,
      },
      message,
    });
    assertEquals(verifyRes.status, 200);
    const verifyBody = await verifyRes.json();
    assertEquals(verifyBody.verified, true);
    assertEquals(verifyBody.identityPublished, true);
    assertEquals(verifyBody.fingerprint, fingerprint);
  });
});

Deno.test("POST /verify-signature rejects detached signatures without message", async () => {
  await withServer(async (mod) => {
    const verifyRes = await postVerifySignature(mod, {
      payload: {
        type: "ebp-signature",
        messageHash: sha256Hex("x"),
        salt: "",
        signature: "deadbeef",
        fingerprint: "abc",
      },
    });
    assertEquals(verifyRes.status, 400);
    const body = await verifyRes.json();
    assert(String(body.error ?? "").includes("message"));
  });
});

Deno.test("POST /verify-signature returns verified false for invalid signature", async () => {
  await withServer(async (mod) => {
    const { payload, fingerprint } = createIdentityPayload();
    const registerRes = await mod.handleRequest(
      new Request("http://localhost/api/v1/identity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
    assertEquals(registerRes.status, 200);

    const verifyRes = await postVerifySignature(mod, {
      payload: {
        type: "ebp-signed-message",
        message: "tampered",
        messageHash: sha256Hex("tampered"),
        salt: "",
        signature: "not-a-valid-signature",
        fingerprint,
      },
    });
    assertEquals(verifyRes.status, 200);
    const body = await verifyRes.json();
    assertEquals(body.verified, false);
    assertEquals(body.identityPublished, false);
  });
});

Deno.test("POST /verify-signature accepts embedded identity alias and reports valid-but-not-published", async () => {
  await withServer(async (mod) => {
    const { payload, fingerprint, signingKey } = createIdentityPayload();
    const message = "this is a test ";
    const signed = signHashedMessageForTest(
      message,
      (value) => signingKey.sign(value),
    );

    // Do not publish identity to server. Verify should still pass with provided keys.
    const verifyRes = await postVerifySignature(mod, {
      payload: {
        type: "ebp-signed-message",
        version: 1,
        fingerprint,
        message,
        messageHash: signed.messageHash,
        salt: signed.salt,
        signature: signed.signature,
      },
      identity: {
        fingerprint,
        signingKeyType: payload.signingKeyType,
        encryptionKeyType: payload.encryptionKeyType,
        signingKey: payload.signingKey,
        encryptionKey: payload.encryptionKey,
        signingKeyDetails: payload.signingKeyDetails,
        encryptionKeyDetails: payload.encryptionKeyDetails,
      },
    });
    assertEquals(verifyRes.status, 200);
    const body = await verifyRes.json();
    assertEquals(body.verified, true);
    assertEquals(body.fingerprint, fingerprint);
    assertEquals(body.identityPublished, false);
    assert(String(body.message ?? "").includes("not found on this server"));
  });
});
