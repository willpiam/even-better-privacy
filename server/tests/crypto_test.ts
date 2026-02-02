import { assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.6";
import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes } from "../../core/Base64.ts";
import {
  canonicalize,
  computeIdentityFingerprint,
  computeStateHash,
  stableStringify,
  concatBytes,
  toHex,
} from "../crypto.ts";
import type { IdentityState } from "../types.ts";

Deno.test("canonicalize and stableStringify sort object keys deterministically", () => {
  const input = { b: 2, a: { d: 4, c: [3, 1] } };
  const expected = { a: { c: [3, 1], d: 4 }, b: 2 };

  const canonical = canonicalize(input);
  assertEquals(canonical, expected);

  const reordered = { a: { d: 4, c: [3, 1] }, b: 2 };
  assertEquals(stableStringify(input), stableStringify(reordered));
});

Deno.test("computeIdentityFingerprint hashes signing and encryption keys in order", () => {
  const signingKey = "AQID"; // base64 for bytes [1, 2, 3]
  const encryptionKey = "feedc0de";

  const signingRaw = sha256(base64ToBytes(signingKey));
  const encryptionRaw = sha256(new TextEncoder().encode(encryptionKey));
  const expected = toHex(sha256(concatBytes(signingRaw, encryptionRaw)));

  const fingerprint = computeIdentityFingerprint({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey,
    encryptionKey,
  });

  assertEquals(fingerprint, expected);
});

Deno.test("computeStateHash changes when state changes", () => {
  const baseState: IdentityState = {
    fingerprint: "fp",
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: "signing",
    encryptionKey: "enc",
    signingKeyDetails: null,
    encryptionKeyDetails: null,
    details: { "profile/name": ["alice", "proof1"] },
  };

  const hash1 = computeStateHash(baseState);
  const hash2 = computeStateHash({
    ...baseState,
    details: { "profile/name": ["bob", "proof1"] },
  });

  assertNotEquals(hash1, hash2);
});

