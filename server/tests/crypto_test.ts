import { assertEquals, assertNotEquals } from "jsr:@std/assert@^1.0.6";
import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes } from "../../core/Base64.ts";
import {
  computeIdentityFingerprint as computeIdentityFingerprintCore,
  decodeFingerprintBech32,
  encodeFingerprintBech32,
  FINGERPRINT_BYTE_LENGTH,
  isValidFingerprintBech32,
} from "../../core/Fingerprint.ts";
import {
  canonicalize,
  computeIdentityFingerprint,
  computeIdentityMerkleRoot,
  computeStateHash,
  stableStringify,
  concatBytes,
  toHex,
} from "../crypto.ts";
import type { IdentityState } from "../types.ts";
import { Identity } from "../../core/Identity.ts";

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
  const expectedRootHex = toHex(sha256(concatBytes(signingRaw, encryptionRaw)));
  const expected = computeIdentityFingerprintCore({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey,
    encryptionKey,
  });

  const fingerprint = computeIdentityFingerprint({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey,
    encryptionKey,
  });

  assertEquals(fingerprint, expected);
  assertEquals(toHex(decodeFingerprintBech32(fingerprint).bytes), expectedRootHex);
});

Deno.test("computeIdentityMerkleRoot returns 32-byte digest", () => {
  const root = computeIdentityMerkleRoot({
    signingKeyType: "sphincs",
    encryptionKeyType: "kyber",
    signingKey: "AQID",
    encryptionKey: "feedc0de",
  });
  assertEquals(root.length, 32);
});

Deno.test("computeIdentityFingerprint changes when either leaf changes", () => {
  const base = {
    signingKeyType: "sphincs" as const,
    encryptionKeyType: "kyber" as const,
    signingKey: "AQID",
    encryptionKey: "feedc0de",
  };
  const fp = computeIdentityFingerprint(base);
  const fpSigningChanged = computeIdentityFingerprint({ ...base, signingKey: "AQIE" });
  const fpEncryptionChanged = computeIdentityFingerprint({ ...base, encryptionKey: "feedc0df" });

  assertNotEquals(fp, fpSigningChanged);
  assertNotEquals(fp, fpEncryptionChanged);
});

Deno.test("server fingerprint helper matches core Identity fingerprint", () => {
  const identity = new Identity("dilithium", "kyber");
  const fpServer = computeIdentityFingerprint({
    signingKeyType: identity.signingKeyType,
    encryptionKeyType: identity.encryptionKeyType,
    signingKey: identity.signingKey.publicKey,
    encryptionKey: identity.encryptionKey.publicKey,
  });
  assertEquals(fpServer, identity.toFingerprint());
});

Deno.test("bech32 fingerprint round-trip preserves bytes and prefix", () => {
  const identity = new Identity("dilithium", "kyber");
  const decoded = decodeFingerprintBech32(identity.toFingerprint());
  const encoded = encodeFingerprintBech32(decoded.bytes, decoded.hrp);

  assertEquals(decoded.bytes.length, FINGERPRINT_BYTE_LENGTH);
  assertEquals(encoded, identity.toFingerprint());
});

Deno.test("bech32 fingerprint rejects mixed-case values", () => {
  const identity = new Identity("dilithium", "kyber");
  const upper = identity.toFingerprint().toUpperCase();
  assertEquals(isValidFingerprintBech32(upper), false);
});

Deno.test("bech32 fingerprint rejects invalid checksum", () => {
  const identity = new Identity("dilithium", "kyber");
  const fp = identity.toFingerprint();
  const last = fp.at(-1) === "q" ? "p" : "q";
  const tampered = `${fp.slice(0, -1)}${last}`;
  assertEquals(isValidFingerprintBech32(tampered), false);
});

Deno.test("bech32 fingerprint rejects unsupported hrp", () => {
  const identity = new Identity("dilithium", "kyber");
  const unsupported = encodeFingerprintBech32(identity.toRawFingerprint(), "addr");
  assertEquals(isValidFingerprintBech32(unsupported), false);
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

