import { assert, assertEquals } from "jsr:@std/assert";
import type { ExternalIdentity } from "../../core/ExternalIdentity.ts";
import { Identity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { handleRequest } from "../../gui/local-backend/routes.ts";
import { getCsrfToken, initSecurity } from "../../gui/local-backend/security.ts";
import {
  decryptMessageWithIdentity,
  encryptMessageWithIdentity,
} from "../../mobile/src/services/encryptDecryptLogic.ts";
import {
  signMessageWithIdentity,
  verifyMessagePayload,
} from "../../mobile/src/services/signVerifyLogic.ts";

// The GUI signs and encrypts through its local backend. Mobile sign, verify,
// encrypt, and decrypt go through the helpers the app screens call. Identities
// are created by the GUI, then loaded with Identity.fromStorageFormat. This
// is not a device run.

const PASSWORD = "Gui-mobile-test1";
const MESSAGE = "GUI mobile compatibility\nline two";

type JsonRecord = Record<string, unknown>;

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

async function guiPost(
  path: string,
  body: JsonRecord,
): Promise<{ status: number; body: JsonRecord }> {
  const req = new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "host": "127.0.0.1:8787",
      "x-ebp-csrf": getCsrfToken(),
    },
    body: JSON.stringify(body),
  });
  const res = await handleRequest(req);
  const parsed = await res.json();
  return { status: res.status, body: parsed as JsonRecord };
}

function signConfirmation(message: string): JsonRecord {
  return {
    approved: true,
    approvedAt: Date.now(),
    messageHash: sha256Hex(message),
  };
}

function asExternal(value: JsonRecord): ExternalIdentity {
  return value as unknown as ExternalIdentity;
}

async function generate(
  home: string,
  name: string,
  signingType: "dilithium" | "sphincs",
): Promise<void> {
  const res = await guiPost("/api/v1/identity/generate", {
    home,
    name,
    password: PASSWORD,
    signingType,
    encryptionType: "kyber",
  });
  assertEquals(res.status, 201, JSON.stringify(res.body));
}

async function exportAndImport(
  home: string,
  name: string,
): Promise<JsonRecord> {
  const exported = await guiPost("/api/v1/identity/export-public", {
    home,
    identity: name,
    password: PASSWORD,
    includeDetails: true,
  });
  assertEquals(exported.status, 200, JSON.stringify(exported.body));
  const imported = await guiPost("/api/v1/contacts/import", {
    home,
    name,
    contact: exported.body,
  });
  assertEquals(imported.status, 200, JSON.stringify(imported.body));
  return exported.body;
}

async function loadStored(home: string, name: string): Promise<Identity> {
  const raw = await Deno.readTextFile(`${home}/.ebp/${name}.identity.json`);
  return Identity.fromStorageFormat(raw, PASSWORD);
}

async function guiSign(
  home: string,
  identity: string,
  options: { detached?: boolean; includeSalt?: boolean } = {},
): Promise<JsonRecord> {
  const res = await guiPost("/api/v1/sign", {
    home,
    identity,
    password: PASSWORD,
    message: MESSAGE,
    detached: options.detached ?? false,
    includeSalt: options.includeSalt ?? true,
    includeIdentity: true,
    signConfirmation: signConfirmation(MESSAGE),
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function guiVerify(
  home: string,
  payload: JsonRecord,
  publicIdentity: JsonRecord,
  message?: string,
): Promise<boolean> {
  const res = await guiPost("/api/v1/verify", {
    home,
    payload,
    publicIdentity,
    ...(message === undefined ? {} : { message }),
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return res.body.verified === true;
}

function mobileVerify(
  payload: JsonRecord,
  sender: ExternalIdentity,
  message?: string,
): boolean {
  return verifyMessagePayload({
    payload,
    publicIdentity: sender,
    ...(message === undefined ? {} : { message }),
  }).verified;
}

Deno.test("GUI and mobile accept each other's payloads", async () => {
  await initSecurity({ persist: false, host: "127.0.0.1", port: 8787 });
  const home = await Deno.makeTempDir({ prefix: "ebp-gui-mobile-" });
  try {
    await generate(home, "alice", "dilithium");
    await generate(home, "bob", "dilithium");
    await generate(home, "carol", "sphincs");

    const alice = await loadStored(home, "alice");
    const bob = await loadStored(home, "bob");
    const carol = await loadStored(home, "carol");
    const alicePublic = asExternal(await exportAndImport(home, "alice"));
    const bobPublic = asExternal(await exportAndImport(home, "bob"));
    const carolPublic = asExternal(await exportAndImport(home, "carol"));
    assertEquals(alicePublic.fingerprint, alice.toFingerprint());
    assertEquals(alicePublic.signingKey, alice.summary.signingKey);
    assertEquals(bobPublic.encryptionKey, bob.summary.encryptionKey);
    assertEquals(carolPublic.fingerprint, carol.toFingerprint());

    const guiAttached = await guiSign(home, "alice");
    assertEquals(guiAttached.type, "ebp-signed-message");
    assert(
      mobileVerify(guiAttached, alicePublic),
      "mobile rejected a salted GUI signature",
    );
    assertEquals(
      mobileVerify({
        ...guiAttached,
        signature: tamperSignature(String(guiAttached.signature)),
      }, alicePublic),
      false,
      "mobile accepted a tampered GUI signature",
    );

    const guiUnsalted = await guiSign(home, "alice", { includeSalt: false });
    assertEquals(guiUnsalted.salt, "");
    assert(
      mobileVerify(guiUnsalted, alicePublic),
      "mobile rejected an unsalted GUI signature",
    );

    const guiDetached = await guiSign(home, "alice", { detached: true });
    assertEquals(guiDetached.type, "ebp-signature");
    assert(
      mobileVerify(guiDetached, alicePublic, MESSAGE),
      "mobile rejected a detached GUI signature",
    );

    const guiSphincs = await guiSign(home, "carol", { includeSalt: false });
    assert(
      mobileVerify(guiSphincs, carolPublic),
      "mobile rejected a GUI SPHINCS+ signature",
    );

    const mobileAttached = signMessageWithIdentity(alice, MESSAGE, {
      includeIdentity: true,
    });
    assertEquals(mobileAttached.type, "ebp-signed-message");
    assertEquals(mobileAttached.fingerprint, alice.toFingerprint());
    assert(
      await guiVerify(home, mobileAttached, alicePublic),
      "GUI rejected a salted mobile signature",
    );
    assertEquals(
      await guiVerify(home, {
        ...mobileAttached,
        signature: tamperSignature(String(mobileAttached.signature)),
      }, alicePublic),
      false,
      "GUI accepted a tampered mobile signature",
    );

    const mobileUnsalted = signMessageWithIdentity(alice, MESSAGE, {
      includeSalt: false,
    });
    assertEquals(mobileUnsalted.salt, "");
    assert(
      await guiVerify(home, mobileUnsalted, alicePublic),
      "GUI rejected an unsalted mobile signature",
    );

    const mobileDetached = signMessageWithIdentity(alice, MESSAGE, {
      detached: true,
      includeIdentity: true,
    });
    assertEquals(mobileDetached.type, "ebp-signature");
    assert(
      await guiVerify(home, mobileDetached, alicePublic, MESSAGE),
      "GUI rejected a detached mobile signature",
    );

    const mobileSphincs = signMessageWithIdentity(carol, MESSAGE, {
      includeSalt: false,
    });
    assert(
      await guiVerify(home, mobileSphincs, carolPublic),
      "GUI rejected a mobile SPHINCS+ signature",
    );

    const guiEncrypted = await guiPost("/api/v1/encrypt", {
      home,
      identity: "alice",
      recipient: "bob",
      message: MESSAGE,
    });
    assertEquals(guiEncrypted.status, 200, JSON.stringify(guiEncrypted.body));
    assertEquals(guiEncrypted.body.type, "ebp-encrypted-message");
    const mobileDecryptUnsigned = decryptMessageWithIdentity({
      identity: bob,
      payload: guiEncrypted.body,
    });
    assertEquals(mobileDecryptUnsigned.message, MESSAGE);
    assertEquals(mobileDecryptUnsigned.verifyStatus, "unsigned");

    const mobileEncrypted = encryptMessageWithIdentity({
      message: MESSAGE,
      recipient: alicePublic,
    });
    assertEquals(mobileEncrypted.type, "ebp-encrypted-message");
    const guiDecryptUnsigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "alice",
      password: PASSWORD,
      payload: mobileEncrypted,
    });
    assertEquals(
      guiDecryptUnsigned.status,
      200,
      JSON.stringify(guiDecryptUnsigned.body),
    );
    assertEquals(guiDecryptUnsigned.body.message, MESSAGE);
    assertEquals(guiDecryptUnsigned.body.verified, null);

    const guiSignedEncrypt = await guiPost("/api/v1/encrypt", {
      home,
      identity: "alice",
      password: PASSWORD,
      recipient: "bob",
      message: MESSAGE,
      sign: true,
    });
    assertEquals(
      guiSignedEncrypt.status,
      200,
      JSON.stringify(guiSignedEncrypt.body),
    );
    const mobileDecryptSigned = decryptMessageWithIdentity({
      identity: bob,
      payload: guiSignedEncrypt.body,
      sender: alicePublic,
    });
    assertEquals(mobileDecryptSigned.message, MESSAGE);
    assertEquals(mobileDecryptSigned.verified, true);

    const mobileSignedEncrypt = encryptMessageWithIdentity({
      message: MESSAGE,
      recipient: alicePublic,
      identity: bob,
      sign: true,
    });
    assertEquals(mobileSignedEncrypt.type, "ebp-encrypted-signed-message");
    const guiDecryptSigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "alice",
      password: PASSWORD,
      sender: "bob",
      payload: mobileSignedEncrypt,
    });
    assertEquals(
      guiDecryptSigned.status,
      200,
      JSON.stringify(guiDecryptSigned.body),
    );
    assertEquals(guiDecryptSigned.body.message, MESSAGE);
    assertEquals(guiDecryptSigned.body.verified, true);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
