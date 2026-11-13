import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import {
  computeEncryptionLeafRaw,
  computeIdentityFingerprint,
} from "../../core/Fingerprint.ts";
import { toHex } from "../../core/Hex.ts";
import { buildMessageHashEnvelope, sha256Hex } from "../../core/MessageHash.ts";
import { handleVerifySignature } from "../handlers/verify.ts";
import { type DatabaseAdapter } from "../db/adapter.ts";

// All these requests either fail before DB access or verify an unpublished key.
const emptyDb: DatabaseAdapter = {
  writeTransaction: async operation => operation(emptyDb),
  query: () => Promise.resolve([]),
  execute: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

const signer = new DilithiumSigningKey();
const victim = new DilithiumSigningKey();
const encryptionKey = "ab".repeat(32);
const victimFingerprint = computeIdentityFingerprint({
  signingKeyType: "dilithium",
  encryptionKeyType: "kyber",
  signingKey: victim.publicKey,
  encryptionKey,
});
const message = "signed by the attacker, not the claimed victim";
const signature = signer.sign(buildMessageHashEnvelope(message));

async function verify(
  publicIdentity: Record<string, unknown>,
  fingerprint?: string,
) {
  return await handleVerifySignature(
    new Request("http://localhost/api/v1/verify-signature", {
      method: "POST",
      body: JSON.stringify({
        message,
        messageHash: sha256Hex(message),
        signature,
        fingerprint,
        publicIdentity,
      }),
    }),
    emptyDb,
  );
}

const signingIdentity = {
  signingKeyType: "dilithium",
  signingKey: signer.publicKey,
  signingKeyDetails: { variant: signer.variant },
};

Deno.test("verification rejects unbound fingerprint claims in both embedded identity and outer payload", async () => {
  for (
    const metadata of [{}, { encryptionKeyType: "kyber" }, {
      encryptionKeyType: "other",
      encryptionKey,
    }]
  ) {
    for (const claimInIdentity of [false, true]) {
      const response = await verify({
        ...signingIdentity,
        ...metadata,
        ...(claimInIdentity ? { fingerprint: victimFingerprint } : {}),
      }, claimInIdentity ? undefined : victimFingerprint);
      assertEquals(response.status, 400);
      assert(
        String((await response.json()).error).includes(
          "verify its fingerprint",
        ),
      );
    }
  }
});

Deno.test("verification rejects a victim fingerprint paired with attacker keys even with encryption metadata", async () => {
  const response = await verify({
    ...signingIdentity,
    fingerprint: victimFingerprint,
    encryptionKeyType: "kyber",
    encryptionKey,
  });
  assertEquals(response.status, 400);
  assert(String((await response.json()).error).includes("does not match"));

  const emptyEmbeddedFingerprint = await verify({
    ...signingIdentity,
    fingerprint: "",
    encryptionKeyType: "kyber",
    encryptionKey,
  }, victimFingerprint);
  assertEquals(emptyEmbeddedFingerprint.status, 400);
  assert(
    String((await emptyEmbeddedFingerprint.json()).error).includes(
      "fingerprint mismatch",
    ),
  );
});

Deno.test("verification accepts bound fingerprints with a full encryption key or its hash", async () => {
  const fingerprint = computeIdentityFingerprint({
    signingKeyType: "dilithium",
    encryptionKeyType: "kyber",
    signingKey: signer.publicKey,
    encryptionKey,
  });
  for (
    const metadata of [{ encryptionKey }, {
      encryptionKeyHash: toHex(
        computeEncryptionLeafRaw("kyber", encryptionKey),
      ),
    }]
  ) {
    const response = await verify({
      ...signingIdentity,
      fingerprint,
      encryptionKeyType: "kyber",
      ...metadata,
    }, fingerprint);
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.verified, true);
    assertEquals(body.fingerprint, fingerprint);
    assertEquals(body.identityPublished, false);
  }
});

Deno.test("a bare signing key can verify without claiming an identity fingerprint", async () => {
  const response = await verify(signingIdentity);
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.verified, true);
  assertEquals(body.fingerprint, null);
  assertEquals(body.identityPublished, false);
});
