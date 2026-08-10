import { assertEquals } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  computeEncryptionLeafRaw,
  computeIdentityFingerprint,
  computeSigningLeafRaw,
  decodeFingerprintBech32,
  encodeFingerprintBech32,
  isValidFingerprintBech32,
  shortFingerprint,
} from "../core/Fingerprint.ts";
import { hexToBytes, toHex } from "../core/Hex.ts";
import { sha256 } from "@noble/hashes/sha2";

Deno.test("Fingerprint: uses dilithium+kyber prefix", () => {
  const identity = new Identity("dilithium", "kyber");
  const fp = computeIdentityFingerprint({
    signingKeyType: identity.signingKeyType,
    encryptionKeyType: identity.encryptionKeyType,
    signingKey: identity.signingKey.publicKey,
    encryptionKey: identity.encryptionKey.publicKey,
  });
  assertEquals(fp.startsWith("ebpdk1"), true);
});

Deno.test("Fingerprint: uses sphincs+kyber prefix", () => {
  const identity = new Identity("sphincs", "kyber");
  const fp = identity.toFingerprint();
  assertEquals(fp.startsWith("ebpsk1"), true);
});

Deno.test("Fingerprint: decode/encode roundtrip", () => {
  const identity = new Identity("dilithium", "kyber");
  const decoded = decodeFingerprintBech32(identity.toFingerprint());
  const reencoded = encodeFingerprintBech32(decoded.bytes, decoded.hrp);
  assertEquals(reencoded, identity.toFingerprint());
});

Deno.test("Fingerprint: rejects invalid checksum", () => {
  const identity = new Identity("dilithium", "kyber");
  const fp = identity.toFingerprint();
  const tampered = `${fp.slice(0, -1)}${fp.at(-1) === "q" ? "p" : "q"}`;
  assertEquals(isValidFingerprintBech32(tampered), false);
});

Deno.test("Fingerprint: rejects mixed-case bech32", () => {
  const identity = new Identity("dilithium", "kyber");
  assertEquals(
    isValidFingerprintBech32(identity.toFingerprint().toUpperCase()),
    false,
  );
});

Deno.test("Fingerprint: encryption leaf hashes decoded hex bytes", () => {
  const encryptionPublicKey = "0001020a0b0c";
  assertEquals(
    computeEncryptionLeafRaw("kyber", encryptionPublicKey),
    sha256(hexToBytes(encryptionPublicKey)),
  );
});

Deno.test("Fingerprint: can compute identity from one omitted key hash", () => {
  const identity = new Identity("dilithium", "kyber");
  const expected = identity.toFingerprint();
  const signingKeyHash = computeSigningLeafRaw(
    identity.signingKeyType,
    identity.signingKey.publicKey,
  );
  const encryptionKeyHash = computeEncryptionLeafRaw(
    identity.encryptionKeyType,
    identity.encryptionKey.publicKey,
  );

  assertEquals(
    computeIdentityFingerprint({
      signingKeyType: identity.signingKeyType,
      encryptionKeyType: identity.encryptionKeyType,
      signingKeyHash: toHex(signingKeyHash),
      encryptionKey: identity.encryptionKey.publicKey,
    }),
    expected,
  );
  assertEquals(
    computeIdentityFingerprint({
      signingKeyType: identity.signingKeyType,
      encryptionKeyType: identity.encryptionKeyType,
      signingKey: identity.signingKey.publicKey,
      encryptionKeyHash: toHex(encryptionKeyHash),
    }),
    expected,
  );
});

Deno.test("Fingerprint: shortFingerprint uses 12…12 for long fingerprints", () => {
  const identity = new Identity("dilithium", "kyber");
  const fp = identity.toFingerprint();
  assertEquals(fp.length >= 25, true);
  assertEquals(
    shortFingerprint(fp),
    `${fp.slice(0, 12)}…${fp.slice(-12)}`,
  );
  assertEquals(identity.toShortFingerprint(), shortFingerprint(fp));
});

Deno.test("Fingerprint: shortFingerprint leaves short strings unchanged", () => {
  assertEquals(shortFingerprint("ebpdk1short"), "ebpdk1short");
  assertEquals(shortFingerprint("a".repeat(24)), "a".repeat(24));
});
