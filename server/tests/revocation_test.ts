import { assertEquals, assertFalse, assert } from "jsr:@std/assert@^1.0.6";
import { verifyRevocationCertificate } from "../revocation.ts";
import { createSphincsIdentity, encodeProof } from "./helpers.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";

const textEncoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function createSignedRevocationCertificate(
  signingKey: SphincsSigningKey,
  data: {
    type: "detail" | "identity";
    fingerprint: string;
    nonce: number;
    timestamp: number;
    reason?: string;
    target?: string;
  },
): string {
  const payload = {
    type: data.type,
    fingerprint: data.fingerprint,
    nonce: data.nonce,
    timestamp: data.timestamp,
    reason: data.reason,
    target: data.target,
    signature: null,
  };

  const signature = signingKey.sign(JSON.stringify(payload));
  const signedCert = { ...payload, signature };

  return toHex(textEncoder.encode(JSON.stringify(signedCert)));
}

Deno.test("verifyRevocationCertificate accepts a valid detail revocation", () => {
  const { identity, signingKey } = createSphincsIdentity();
  const nonce = 1;
  const timestamp = Date.now();

  const certificate = createSignedRevocationCertificate(signingKey, {
    type: "detail",
    fingerprint: identity.fingerprint,
    nonce,
    timestamp,
    reason: "Old email",
    target: "email",
  });

  const result = verifyRevocationCertificate(identity, certificate, "detail", "email");
  
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.record.type, "detail");
    assertEquals(result.record.target, "email");
    assertEquals(result.record.nonce, nonce);
    assertEquals(result.record.reason, "Old email");
  }
});

Deno.test("verifyRevocationCertificate accepts a valid identity revocation", () => {
  const { identity, signingKey } = createSphincsIdentity();
  const nonce = 0;
  const timestamp = Date.now();

  const certificate = createSignedRevocationCertificate(signingKey, {
    type: "identity",
    fingerprint: identity.fingerprint,
    nonce,
    timestamp,
    reason: "Compromised",
  });

  const result = verifyRevocationCertificate(identity, certificate, "identity");
  
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.record.type, "identity");
    assertEquals(result.record.nonce, nonce);
    assertEquals(result.record.reason, "Compromised");
  }
});

Deno.test("verifyRevocationCertificate rejects mismatched type", () => {
  const { identity, signingKey } = createSphincsIdentity();

  const certificate = createSignedRevocationCertificate(signingKey, {
    type: "detail",
    fingerprint: identity.fingerprint,
    nonce: 0,
    timestamp: Date.now(),
    target: "email",
  });

  // Expect identity revocation but certificate is for detail
  const result = verifyRevocationCertificate(identity, certificate, "identity");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("expected identity"));
  }
});

Deno.test("verifyRevocationCertificate rejects mismatched fingerprint", () => {
  const { identity, signingKey } = createSphincsIdentity();

  const certificate = createSignedRevocationCertificate(signingKey, {
    type: "identity",
    fingerprint: "wrong-fingerprint",
    nonce: 0,
    timestamp: Date.now(),
  });

  const result = verifyRevocationCertificate(identity, certificate, "identity");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("fingerprint mismatch"));
  }
});

Deno.test("verifyRevocationCertificate rejects mismatched target path", () => {
  const { identity, signingKey } = createSphincsIdentity();

  const certificate = createSignedRevocationCertificate(signingKey, {
    type: "detail",
    fingerprint: identity.fingerprint,
    nonce: 0,
    timestamp: Date.now(),
    target: "name",
  });

  // Expect target "email" but certificate has target "name"
  const result = verifyRevocationCertificate(identity, certificate, "detail", "email");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("target path mismatch"));
  }
});

Deno.test("verifyRevocationCertificate rejects invalid signature", () => {
  const { identity } = createSphincsIdentity();

  const invalidCert = {
    type: "identity",
    fingerprint: identity.fingerprint,
    nonce: 0,
    timestamp: Date.now(),
    signature: "not-a-valid-signature",
  };

  const encoded = toHex(textEncoder.encode(JSON.stringify(invalidCert)));
  const result = verifyRevocationCertificate(identity, encoded, "identity");
  
  assertFalse(result.ok);
  if (!result.ok) {
    // The error could be about signature verification failing or invalid signature
    assert(
      result.error?.includes("signature") || result.error?.includes("failed"),
      `Expected error about signature, got: ${result.error}`
    );
  }
});

Deno.test("verifyRevocationCertificate rejects invalid encoding", () => {
  const { identity } = createSphincsIdentity();

  const result = verifyRevocationCertificate(identity, "not-valid-hex", "identity");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("invalid certificate encoding"));
  }
});

Deno.test("verifyRevocationCertificate rejects detail revocation without target", () => {
  const { identity, signingKey } = createSphincsIdentity();

  // Create a detail revocation without target
  const payload = {
    type: "detail",
    fingerprint: identity.fingerprint,
    nonce: 0,
    timestamp: Date.now(),
    signature: null,
  };

  const signature = signingKey.sign(JSON.stringify(payload));
  const signedCert = { ...payload, signature };
  const encoded = toHex(textEncoder.encode(JSON.stringify(signedCert)));

  const result = verifyRevocationCertificate(identity, encoded, "detail");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("target path"));
  }
});

Deno.test("verifyRevocationCertificate rejects invalid nonce", () => {
  const { identity, signingKey } = createSphincsIdentity();

  const payload = {
    type: "identity" as const,
    fingerprint: identity.fingerprint,
    nonce: -1, // Invalid negative nonce
    timestamp: Date.now(),
    signature: null as string | null,
  };

  const signature = signingKey.sign(JSON.stringify(payload));
  const signedCert = { ...payload, signature };
  const encoded = toHex(textEncoder.encode(JSON.stringify(signedCert)));

  const result = verifyRevocationCertificate(identity, encoded, "identity");
  
  assertFalse(result.ok);
  if (!result.ok) {
    assert(result.error?.includes("invalid nonce"));
  }
});

