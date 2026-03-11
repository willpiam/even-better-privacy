import { assert, assertEquals, assertFalse, assertThrows } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import { stringToHex } from "../core/Hex.ts";
import {
	createRevocationCertificate,
	decodeRevocationCertificate,
	encodeRevocationCertificate,
	getRevocationSignaturePayload,
	verifyRevocationCertificate,
	type SignedRevocationCertificate,
} from "../core/Revocation.ts";

Deno.test("Revocation: createRevocationCertificate creates valid certificate", () => {
	const cert = createRevocationCertificate("detail", "test-fingerprint", 0, {
		reason: "Test reason",
		target: "email",
	});

	assertEquals(cert.type, "detail");
	assertEquals(cert.fingerprint, "test-fingerprint");
	assertEquals(cert.nonce, 0);
	assertEquals(cert.reason, "Test reason");
	assertEquals(cert.target, "email");
	assertEquals(cert.signature, null);
	assert(typeof cert.timestamp === "number");
});

Deno.test("Revocation: encodeRevocationCertificate and decodeRevocationCertificate round-trip", () => {
	const cert: SignedRevocationCertificate = {
		type: "identity",
		fingerprint: "test-fingerprint",
		nonce: 5,
		timestamp: Date.now(),
		reason: "Compromised",
		target: undefined,
		signature: "test-signature",
	};

	const encoded = encodeRevocationCertificate(cert);
	const decoded = decodeRevocationCertificate(encoded);

	assert(decoded !== null);
	assertEquals(decoded.type, cert.type);
	assertEquals(decoded.fingerprint, cert.fingerprint);
	assertEquals(decoded.nonce, cert.nonce);
	assertEquals(decoded.timestamp, cert.timestamp);
	assertEquals(decoded.reason, cert.reason);
	assertEquals(decoded.signature, cert.signature);
});

Deno.test("Revocation: decodeRevocationCertificate returns null for invalid input", () => {
	assertEquals(decodeRevocationCertificate("not-valid-hex"), null);
	assertEquals(decodeRevocationCertificate(""), null);
	
	// Valid hex but invalid JSON
	const invalidHex = stringToHex("not json");
	assertEquals(decodeRevocationCertificate(invalidHex), null);
});

Deno.test("Revocation: Identity.revokeDetail creates valid revocation", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.attachDetail("email", "test@example.com");
	
	assert(identity.details.has("email"));
	assertFalse(identity.isDetailRevoked("email"));
	
	const certificate = identity.revokeDetail("email", "Changed email");
	
	assertFalse(identity.details.has("email"));
	assert(identity.isDetailRevoked("email"));
	assert(typeof certificate === "string");
	assert(certificate.length > 0);
	
	// Verify the certificate can be decoded
	const decoded = decodeRevocationCertificate(certificate);
	assert(decoded !== null);
	assertEquals(decoded.type, "detail");
	assertEquals(decoded.target, "email");
	assertEquals(decoded.reason, "Changed email");
	assertEquals(decoded.fingerprint, identity.toFingerprint());
});

Deno.test("Revocation: Identity.revokeDetail throws for non-existent detail", () => {
	const identity = new Identity("dilithium", "kyber");
	
	assertThrows(
		() => identity.revokeDetail("nonexistent"),
		Error,
		"Detail not found"
	);
});

Deno.test("Revocation: Identity.createIdentityRevocation creates valid revocation", () => {
	const identity = new Identity("sphincs", "kyber");
	
	assertFalse(identity.isRevoked());
	
	const certificate = identity.createIdentityRevocation("Key compromised");
	
	assert(identity.isRevoked());
	assert(typeof certificate === "string");
	assert(certificate.length > 0);
	
	// Verify the certificate can be decoded
	const decoded = decodeRevocationCertificate(certificate);
	assert(decoded !== null);
	assertEquals(decoded.type, "identity");
	assertEquals(decoded.reason, "Key compromised");
	assertEquals(decoded.fingerprint, identity.toFingerprint());
});

Deno.test("Revocation: Identity.createIdentityRevocation throws if already revoked", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.createIdentityRevocation("First revocation");
	
	assertThrows(
		() => identity.createIdentityRevocation("Second revocation"),
		Error,
		"already revoked"
	);
});

Deno.test("Revocation: verifyRevocationCertificate validates signature", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.attachDetail("test", "value");
	
	const certificate = identity.revokeDetail("test", "Revoked");
	const decoded = decodeRevocationCertificate(certificate)!;
	
	// Get variant from the summary which has the proper structure
	const summary = identity.summary;
	const variant = summary.signingKeyDetails.variant;
	
	const result = verifyRevocationCertificate(
		decoded,
		identity.signingKeyType,
		identity.signingKey.publicKey,
		variant,
	);
	
	assert(result.ok);
});

Deno.test("Revocation: verifyRevocationCertificate rejects invalid signature", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.attachDetail("test", "value");
	
	const certificate = identity.revokeDetail("test", "Revoked");
	const decoded = decodeRevocationCertificate(certificate)!;
	
	// Corrupt the signature
	decoded.signature = "invalid-signature";
	
	// Get variant from the summary which has the proper structure
	const summary = identity.summary;
	const variant = summary.signingKeyDetails.variant;
	
	const result = verifyRevocationCertificate(
		decoded,
		identity.signingKeyType,
		identity.signingKey.publicKey,
		variant,
	);
	
	assertFalse(result.ok);
});

Deno.test("Revocation: Identity.VerifyRevocationCertificate works with external identity", () => {
	const identity = new Identity("sphincs", "kyber");
	identity.attachDetail("email", "test@test.com");
	
	const certificate = identity.revokeDetail("email");
	const decoded = decodeRevocationCertificate(certificate)!;
	
	// Get external identity (public keys only)
	const external = identity.summary;
	
	const verified = Identity.VerifyRevocationCertificate(decoded, external);
	assert(verified);
});

Deno.test("Revocation: revocationNonce increments correctly", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.attachDetail("a", "1");
	identity.attachDetail("b", "2");
	identity.attachDetail("c", "3");
	
	assertEquals(identity.revocationNonce, 0);
	
	identity.revokeDetail("a");
	assertEquals(identity.revocationNonce, 1);
	
	identity.revokeDetail("b");
	assertEquals(identity.revocationNonce, 2);
	
	identity.createIdentityRevocation("Done");
	assertEquals(identity.revocationNonce, 3);
});

Deno.test("Revocation: JSON round-trip preserves revocation data", () => {
	const original = new Identity("dilithium", "kyber");
	original.attachDetail("email", "test@example.com");
	original.attachDetail("name", "Test User");
	
	original.revokeDetail("email", "Old email");
	original.createIdentityRevocation("Compromised");
	
	const json = original.toJSON();
	const restored = Identity.fromJSON(json);
	
	assert(restored.isRevoked());
	assert(restored.isDetailRevoked("email"));
	assertFalse(restored.isDetailRevoked("name"));
	assertEquals(restored.revocationNonce, original.revocationNonce);
	
	// Verify the certificates are preserved
	const originalCert = original.getIdentityRevocationCertificate();
	const restoredCert = restored.getIdentityRevocationCertificate();
	
	assert(originalCert !== null);
	assert(restoredCert !== null);
	assertEquals(restoredCert.nonce, originalCert.nonce);
	assertEquals(restoredCert.reason, originalCert.reason);
});

Deno.test("Revocation: publicData includes revocation information", () => {
	const identity = new Identity("sphincs", "kyber");
	identity.attachDetail("email", "test@test.com");
	identity.attachDetail("name", "Test");
	
	identity.revokeDetail("email");
	
	const publicData = identity.publicData;
	
	assert(publicData.revokedDetails !== undefined);
	assert("email" in publicData.revokedDetails);
	assertEquals(publicData.revocationCertificate, undefined);
	assertEquals(publicData.revocationNonce, 1);
});

Deno.test("Revocation: getDetailRevocationCertificate returns certificate for revoked detail", () => {
	const identity = new Identity("dilithium", "kyber");
	identity.attachDetail("test", "value");
	
	// Before revocation
	assertEquals(identity.getDetailRevocationCertificate("test"), null);
	
	identity.revokeDetail("test", "No longer valid");
	
	// After revocation
	const cert = identity.getDetailRevocationCertificate("test");
	assert(cert !== null);
	assertEquals(cert.type, "detail");
	assertEquals(cert.target, "test");
	assertEquals(cert.reason, "No longer valid");
});

Deno.test("Revocation: generateEmergencyRevocationCertificate creates valid certificate", () => {
	const identity = new Identity("dilithium", "kyber");
	
	const emergencyCert = identity.generateEmergencyRevocationCertificate();
	
	// Certificate should be valid hex-encoded JSON
	assert(typeof emergencyCert === "string");
	assert(emergencyCert.length > 0);
	
	// Decode and verify structure
	const decoded = decodeRevocationCertificate(emergencyCert);
	assert(decoded !== null);
	assertEquals(decoded.type, "identity");
	assertEquals(decoded.nonce, 0); // Emergency certs use nonce 0
	assertEquals(decoded.fingerprint, identity.toFingerprint());
	assert(decoded.signature !== null);
});

Deno.test("Revocation: emergency certificate can be verified against external identity", () => {
	const identity = new Identity("sphincs", "kyber");
	
	const emergencyCert = identity.generateEmergencyRevocationCertificate("Backup revocation");
	const decoded = decodeRevocationCertificate(emergencyCert)!;
	
	// Verify against external identity
	const external = identity.summary;
	const verified = Identity.VerifyRevocationCertificate(decoded, external);
	assert(verified);
	
	// Check reason is preserved
	assertEquals(decoded.reason, "Backup revocation");
});

Deno.test("Revocation: emergency certificate does NOT revoke the identity immediately", () => {
	const identity = new Identity("dilithium", "kyber");
	
	// Generate emergency certificate
	identity.generateEmergencyRevocationCertificate();
	
	// Identity should NOT be revoked yet
	assertFalse(identity.isRevoked());
	assertEquals(identity.revocationNonce, 0); // Nonce unchanged
});

