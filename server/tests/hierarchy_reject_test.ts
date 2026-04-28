import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { buildMessageHashEnvelope, buildPurposeHashEnvelope } from "../../core/MessageHash.ts";
import {
  createHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  type SignedHierarchyCertificate,
} from "../../core/HierarchyCertificate.ts";
import { stableStringify } from "../../core/StateHash.ts";
import { createIdentityPayload } from "./helpers.ts";

type MainModule = typeof import("../main.ts");

async function withServer(fn: (mod: MainModule) => Promise<void>): Promise<void> {
  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  Deno.env.set("DB_PATH", dbPath);
  const mod: MainModule = await import(`../main.ts#${crypto.randomUUID()}`);
  try {
    await fn(mod);
  } finally {
    try { await mod.closeDb(); } catch { /* ignore */ }
    try { Deno.removeSync(dbPath); } catch { /* ignore */ }
    Deno.env.delete("DB_PATH");
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
  return {
    fingerprint,
    sign: (message: string) => signingKey.sign(buildMessageHashEnvelope(message)),
    signHierarchy: (message: string) => signingKey.sign(buildPurposeHashEnvelope("hierarchy", message)),
  };
}

async function proposeRelation(
  mod: MainModule,
  master: Awaited<ReturnType<typeof registerIdentity>>,
  child: Awaited<ReturnType<typeof registerIdentity>>,
  proposer: Awaited<ReturnType<typeof registerIdentity>>,
): Promise<number> {
  const cert = createHierarchyCertificate(master.fingerprint, child.fingerprint, {
    context: "parent",
    expiry: 0,
  });
  const payload = getHierarchySignaturePayload(cert);
  if (proposer.fingerprint === master.fingerprint) {
    cert.masterSignature = master.signHierarchy(payload);
  } else {
    cert.childSignature = child.signHierarchy(payload);
  }
  const encoded = encodeHierarchyCertificate(cert as SignedHierarchyCertificate);

  const res = await mod.handleRequest(
    new Request("http://localhost/api/v1/hierarchy/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        certificate: encoded,
        proposerFingerprint: proposer.fingerprint,
      }),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  return body.proposal.id as number;
}

function rejectMessage(input: { proposalId: number; fingerprint: string; timestamp: number }): string {
  return stableStringify({
    action: "hierarchy::reject",
    fingerprint: input.fingerprint,
    proposalId: input.proposalId,
    timestamp: input.timestamp,
  });
}

Deno.test("F-SERVER-02: reject without signature returns 400", async () => {
  await withServer(async (mod) => {
    const master = await registerIdentity(mod);
    const child = await registerIdentity(mod);
    const proposalId = await proposeRelation(mod, master, child, master);

    const res = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposalId, fingerprint: child.fingerprint }),
      }),
    );
    // Missing timestamp/signature both result in 400 from validation.
    assertEquals(res.status, 400);
  });
});

Deno.test("F-SERVER-02: reject with bad signature returns 401", async () => {
  await withServer(async (mod) => {
    const master = await registerIdentity(mod);
    const child = await registerIdentity(mod);
    const proposalId = await proposeRelation(mod, master, child, master);

    const timestamp = Date.now();
    // Sign the WRONG message to produce a garbage-but-syntactically-valid sig.
    const badSig = child.sign("not the reject message");

    const res = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          fingerprint: child.fingerprint,
          timestamp,
          signature: badSig,
        }),
      }),
    );
    assertEquals(res.status, 401);
  });
});

Deno.test("F-SERVER-02: reject with valid signature succeeds and removes proposal", async () => {
  await withServer(async (mod) => {
    const master = await registerIdentity(mod);
    const child = await registerIdentity(mod);
    const proposalId = await proposeRelation(mod, master, child, master);

    const timestamp = Date.now();
    const msg = rejectMessage({ proposalId, fingerprint: child.fingerprint, timestamp });
    const signature = child.sign(msg);

    const res = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          fingerprint: child.fingerprint,
          timestamp,
          signature,
        }),
      }),
    );
    assertEquals(res.status, 200);

    // A second reject should 404 because the proposal is gone.
    const res2 = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          fingerprint: child.fingerprint,
          timestamp,
          signature,
        }),
      }),
    );
    assertEquals(res2.status, 404);
  });
});

Deno.test("F-SERVER-02: reject with stale timestamp returns 400", async () => {
  await withServer(async (mod) => {
    const master = await registerIdentity(mod);
    const child = await registerIdentity(mod);
    const proposalId = await proposeRelation(mod, master, child, master);

    const timestamp = Date.now() - 10 * 60 * 1000; // 10 min in the past
    const msg = rejectMessage({ proposalId, fingerprint: child.fingerprint, timestamp });
    const signature = child.sign(msg);

    const res = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          fingerprint: child.fingerprint,
          timestamp,
          signature,
        }),
      }),
    );
    assertEquals(res.status, 400);
  });
});
