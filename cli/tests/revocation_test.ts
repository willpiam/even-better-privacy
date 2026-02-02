import { assert, assertEquals, assertFalse } from "jsr:@std/assert";
import { Identity } from "../../core/Identity.ts";
import { decodeRevocationCertificate } from "../../core/Revocation.ts";

// These tests validate the revocation workflow from the CLI perspective,
// testing the core Identity methods that the CLI commands use.

Deno.test("CLI revocation: revokeDetail removes detail and stores certificate", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("email", "old@example.com");
  identity.attachDetail("name", "Test User");
  
  // Verify detail exists
  assert(identity.details.has("email"));
  assertEquals(identity.getDetail("email"), "old@example.com");
  
  // Revoke the detail
  const certificate = identity.revokeDetail("email", "Changed email address");
  
  // Detail should be removed
  assertFalse(identity.details.has("email"));
  assertEquals(identity.getDetail("email"), null);
  
  // Other details should remain
  assert(identity.details.has("name"));
  
  // Revocation should be tracked
  assert(identity.isDetailRevoked("email"));
  assertFalse(identity.isDetailRevoked("name"));
  
  // Certificate should be valid
  const decoded = decodeRevocationCertificate(certificate);
  assert(decoded !== null);
  assertEquals(decoded.type, "detail");
  assertEquals(decoded.target, "email");
  assertEquals(decoded.reason, "Changed email address");
});

Deno.test("CLI revocation: createIdentityRevocation marks identity as revoked", () => {
  const identity = new Identity("sphincs", "kyber");
  
  assertFalse(identity.isRevoked());
  
  const certificate = identity.createIdentityRevocation("Key compromised - laptop stolen");
  
  assert(identity.isRevoked());
  
  // Certificate should be valid
  const decoded = decodeRevocationCertificate(certificate);
  assert(decoded !== null);
  assertEquals(decoded.type, "identity");
  assertEquals(decoded.reason, "Key compromised - laptop stolen");
  assertEquals(decoded.fingerprint, identity.toFingerprint());
});

Deno.test("CLI revocation: revocation persists through JSON serialization", async () => {
  const original = new Identity("dilithium", "kyber");
  original.attachDetail("email", "test@example.com");
  original.attachDetail("phone", "+1234567890");
  
  // Revoke email
  original.revokeDetail("email", "No longer using this email");
  
  // Serialize and restore
  const json = original.toJSON();
  const restored = Identity.fromJSON(json);
  
  // Check revocation state is preserved
  assertFalse(restored.details.has("email"));
  assert(restored.details.has("phone"));
  assert(restored.isDetailRevoked("email"));
  assertFalse(restored.isDetailRevoked("phone"));
  assertEquals(restored.revocationNonce, 1);
});

Deno.test("CLI revocation: revocation persists through storage format", async () => {
  const original = new Identity("sphincs", "kyber");
  original.attachDetail("name", "Alice");
  
  // Create identity revocation
  original.createIdentityRevocation("Migrating to new identity");
  
  // Use storage format (as CLI would do)
  const password = "testpassword123";
  const storageData = await original.toStorageFormat(password);
  
  // Restore from storage
  const restored = await Identity.fromStorageFormat(storageData, password);
  
  assert(restored.isRevoked());
  assertEquals(restored.revocationNonce, original.revocationNonce);
  
  const originalCert = original.getIdentityRevocationCertificate();
  const restoredCert = restored.getIdentityRevocationCertificate();
  
  assert(originalCert !== null);
  assert(restoredCert !== null);
  assertEquals(restoredCert.reason, "Migrating to new identity");
});

Deno.test("CLI revocation: multiple detail revocations increment nonce", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("a", "1");
  identity.attachDetail("b", "2");
  identity.attachDetail("c", "3");
  
  assertEquals(identity.revocationNonce, 0);
  
  const cert1 = identity.revokeDetail("a");
  assertEquals(identity.revocationNonce, 1);
  
  const cert2 = identity.revokeDetail("b");
  assertEquals(identity.revocationNonce, 2);
  
  // Verify nonces in certificates are different
  const decoded1 = decodeRevocationCertificate(cert1)!;
  const decoded2 = decodeRevocationCertificate(cert2)!;
  
  assertEquals(decoded1.nonce, 0);
  assertEquals(decoded2.nonce, 1);
});

Deno.test("CLI revocation: VerifyRevocationCertificate validates against external identity", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("email", "test@test.com");
  
  const certificate = identity.revokeDetail("email");
  const decoded = decodeRevocationCertificate(certificate)!;
  
  // Get the external (public) representation
  const external = identity.summary;
  
  // Verify certificate against external identity
  const verified = Identity.VerifyRevocationCertificate(decoded, external);
  assert(verified);
});

Deno.test("CLI revocation: VerifyRevocationCertificate rejects certificate from different identity", () => {
  const identity1 = new Identity("dilithium", "kyber");
  const identity2 = new Identity("dilithium", "kyber");
  
  identity1.attachDetail("email", "test@test.com");
  
  const certificate = identity1.revokeDetail("email");
  const decoded = decodeRevocationCertificate(certificate)!;
  
  // Try to verify against different identity
  const external2 = identity2.summary;
  
  const verified = Identity.VerifyRevocationCertificate(decoded, external2);
  assertFalse(verified);
});

Deno.test("CLI revocation: publicData includes revoked details", () => {
  const identity = new Identity("sphincs", "kyber");
  identity.attachDetail("email", "test@test.com");
  identity.attachDetail("phone", "+1234567890");
  identity.attachDetail("name", "Test");
  
  // Revoke email and phone
  identity.revokeDetail("email");
  identity.revokeDetail("phone");
  
  const publicData = identity.publicData;
  
  // revokedDetails should contain the revoked paths
  assert(publicData.revokedDetails !== undefined);
  assert("email" in publicData.revokedDetails);
  assert("phone" in publicData.revokedDetails);
  assertFalse("name" in publicData.revokedDetails);
  
  // Active details should only contain name
  assert("name" in publicData.details);
  assertFalse("email" in publicData.details);
  assertFalse("phone" in publicData.details);
});


