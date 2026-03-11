import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { buildMessageHashEnvelope } from "../../core/MessageHash.ts";
import {
  createHierarchyCertificate,
  encodeHierarchyCertificate,
  getHierarchySignaturePayload,
  type SignedHierarchyCertificate,
} from "../../core/HierarchyCertificate.ts";
import { createIdentityPayload } from "./helpers.ts";

type MainModule = typeof import("../main.ts");

async function withServer(
  fn: (mod: MainModule) => Promise<void>,
): Promise<void> {
  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  Deno.env.set("DB_PATH", dbPath);
  const mod: MainModule = await import(`../main.ts#${crypto.randomUUID()}`);
  try {
    await fn(mod);
  } finally {
    try {
      await mod.closeDb();
    } catch {
      // ignore
    }
    try {
      Deno.removeSync(dbPath);
    } catch {
      // ignore
    }
    Deno.env.delete("DB_PATH");
  }
}

async function registerIdentity(mod: MainModule): Promise<{
  fingerprint: string;
  sign: (payload: string) => string;
}> {
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
    sign: (message) => signingKey.sign(buildMessageHashEnvelope(message)),
  };
}

function makeSignedHierarchyCertificate(input: {
  masterFingerprint: string;
  childFingerprint: string;
  masterSign: (payload: string) => string;
  childSign: (payload: string) => string;
  context?: string;
}): string {
  const cert = createHierarchyCertificate(input.masterFingerprint, input.childFingerprint, {
    context: input.context ?? "",
    expiry: 0,
  });
  const payload = getHierarchySignaturePayload(cert);
  cert.masterSignature = input.masterSign(payload);
  cert.childSignature = input.childSign(payload);
  return encodeHierarchyCertificate(cert as SignedHierarchyCertificate);
}

Deno.test("Hierarchy API: publish + query hierarchy", async () => {
  await withServer(async (mod) => {
    const master = await registerIdentity(mod);
    const child = await registerIdentity(mod);

    const certificate = makeSignedHierarchyCertificate({
      masterFingerprint: master.fingerprint,
      childFingerprint: child.fingerprint,
      masterSign: master.sign,
      childSign: child.sign,
      context: "parent",
    });

    const publish = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate }),
      }),
    );
    assertEquals(publish.status, 200);

    const tree = await mod.handleRequest(
      new Request(`http://localhost/api/v1/hierarchy/${child.fingerprint}`),
    );
    assertEquals(tree.status, 200);
    const treeBody = await tree.json();
    assertEquals(treeBody.root, master.fingerprint);
    assertEquals(treeBody.relationships.length, 1);
    assertEquals(treeBody.relationships[0].masterFingerprint, master.fingerprint);
    assertEquals(treeBody.relationships[0].childFingerprint, child.fingerprint);

    const certRes = await mod.handleRequest(
      new Request(`http://localhost/api/v1/hierarchy/${child.fingerprint}/certificate`),
    );
    assertEquals(certRes.status, 200);
    const certBody = await certRes.json();
    assertEquals(certBody.masterFingerprint, master.fingerprint);
    assertEquals(certBody.childFingerprint, child.fingerprint);
  });
});

Deno.test("Hierarchy API: loop detection rejects cyclic relationship", async () => {
  await withServer(async (mod) => {
    const a = await registerIdentity(mod);
    const b = await registerIdentity(mod);
    const c = await registerIdentity(mod);

    const ab = makeSignedHierarchyCertificate({
      masterFingerprint: a.fingerprint,
      childFingerprint: b.fingerprint,
      masterSign: a.sign,
      childSign: b.sign,
    });
    const bc = makeSignedHierarchyCertificate({
      masterFingerprint: b.fingerprint,
      childFingerprint: c.fingerprint,
      masterSign: b.sign,
      childSign: c.sign,
    });
    const ca = makeSignedHierarchyCertificate({
      masterFingerprint: c.fingerprint,
      childFingerprint: a.fingerprint,
      masterSign: c.sign,
      childSign: a.sign,
    });

    const publishAb = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: ab }),
      }),
    );
    assertEquals(publishAb.status, 200);

    const publishBc = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: bc }),
      }),
    );
    assertEquals(publishBc.status, 200);

    const publishCa = await mod.handleRequest(
      new Request("http://localhost/api/v1/hierarchy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: ca }),
      }),
    );
    assertEquals(publishCa.status, 400);
  });
});
