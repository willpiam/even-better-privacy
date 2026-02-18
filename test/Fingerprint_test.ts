import { assertEquals } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  computeIdentityFingerprint,
  decodeFingerprintBech32,
  encodeFingerprintBech32,
  isValidFingerprintBech32,
} from "../core/Fingerprint.ts";

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
  assertEquals(isValidFingerprintBech32(identity.toFingerprint().toUpperCase()), false);
});

