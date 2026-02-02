import { assertEquals, assertFalse } from "jsr:@std/assert@^1.0.6";
import { verifyDetailProof } from "../detail.ts";
import { createSignedProof, createSphincsIdentity, encodeProof } from "./helpers.ts";

Deno.test("verifyDetailProof accepts a valid signed proof", () => {
  const { identity, signingKey } = createSphincsIdentity();
  const nonce = 1;
  const timestamp = Date.now();
  const { proof } = createSignedProof(signingKey, {
    nonce,
    path: "profile/name",
    detail: "alice",
    timestamp,
  });

  const result = verifyDetailProof(identity, "profile/name", "alice", proof);
  assertEquals(result, { ok: true, record: { nonce, timestamp } });
});

Deno.test("verifyDetailProof rejects mismatched path or detail", () => {
  const { identity, signingKey } = createSphincsIdentity();
  const { proof } = createSignedProof(signingKey, {
    nonce: 0,
    path: "profile/name",
    detail: "alice",
    timestamp: Date.now(),
  });

  const mismatchPath = verifyDetailProof(identity, "profile/email", "alice", proof);
  assertFalse(mismatchPath.ok);

  const mismatchDetail = verifyDetailProof(identity, "profile/name", "bob", proof);
  assertFalse(mismatchDetail.ok);
});

Deno.test("verifyDetailProof rejects invalid signatures and encodings", () => {
  const { identity, signingKey } = createSphincsIdentity();
  const { record } = createSignedProof(signingKey, {
    nonce: 2,
    path: "profile/handle",
    detail: "alice",
    timestamp: Date.now(),
  });

  const badSigProof = encodeProof({ ...record, signature: "not-a-valid-signature" });

  const invalidSignature = verifyDetailProof(identity, "profile/handle", "alice", badSigProof);
  assertFalse(invalidSignature.ok);

  const invalidEncoding = verifyDetailProof(identity, "profile/handle", "alice", "zz");
  assertFalse(invalidEncoding.ok);
});

