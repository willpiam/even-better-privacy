import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import { Buffer } from "node:buffer";
import { sha256 } from "@noble/hashes/sha2";
import { computeIdentityFingerprint } from "../core/Fingerprint.ts";

Deno.test("Identity: creation with dilithium signing key", () => {
	const identity = new Identity("dilithium", "kyber");

	assertEquals(typeof identity.signingKey, "object");
	assertEquals(typeof identity.encryptionKey, "object");
});

Deno.test("Identity: creation with sphincs signing key", () => {
	const identity = new Identity("sphincs", "kyber");

	assertEquals(typeof identity.signingKey, "object");
	assertEquals(typeof identity.encryptionKey, "object");
});

Deno.test("Identity: invalid signing key type throws error", () => {
	assertThrows(
		// @ts-expect-error: testing invalid input
		() => new Identity("invalid_signing_key", "kyber"),
		Error,
		"Unsupported signing key type"
	);
});

Deno.test("Identity: invalid encryption key type throws error", () => {
	assertThrows(
		// @ts-expect-error: testing invalid input
		() => new Identity("dilithium", "invalid_encryption_key"),
		Error,
		"Unsupported encryption key type"
	);
});

Deno.test("Identity: fingerprint is deterministic", () => {
	const identity = new Identity("dilithium", "kyber");
	const fp1 = identity.toFingerprint();
	const fp2 = identity.toFingerprint();

	assertEquals(fp1, fp2);
	assert(fp1.startsWith("ebpdk1"));
});

Deno.test("Identity: rawFingerprint returns Uint8Array", () => {
	const identity = new Identity("dilithium", "kyber");
	const raw = identity.toRawFingerprint();

	assert(raw instanceof Uint8Array);
	// SHA-256 produces 32 bytes
	assertEquals(raw.length, 32);
});

Deno.test("Identity: different identities have different fingerprints", () => {
	const identity1 = new Identity("dilithium", "kyber");
	const identity2 = new Identity("dilithium", "kyber");

	assert(identity1.toFingerprint() !== identity2.toFingerprint());
});

Deno.test("Identity: fingerprint matches explicit merkle root construction", () => {
	const identity = new Identity("dilithium", "kyber");
	const expected = computeIdentityFingerprint({
		signingKeyType: identity.signingKeyType,
		encryptionKeyType: identity.encryptionKeyType,
		signingKey: identity.signingKey.publicKey,
		encryptionKey: identity.encryptionKey.publicKey,
	});
	assertEquals(identity.toFingerprint(), expected);
});

Deno.test("Identity: merkle root order is role-sensitive", () => {
	const identity = new Identity("dilithium", "kyber");
	const signingLeaf = identity.signingKey.toRawFingerprint();
	const encryptionLeaf = identity.encryptionKey.toRawFingerprint();

	const forwardHex = Buffer.from(sha256(Buffer.concat([signingLeaf, encryptionLeaf]))).toString("hex");
	const reverseHex = Buffer.from(sha256(Buffer.concat([encryptionLeaf, signingLeaf]))).toString("hex");

	assert(forwardHex !== reverseHex);
	// toRawFingerprint is the binary merkle root before bech32 encoding.
	assertEquals(Buffer.from(identity.toRawFingerprint()).toString("hex"), forwardHex);
});

Deno.test("Identity: signing and verification through signingKey", () => {
	const identity = new Identity("dilithium", "kyber");
	const msg = "hello identity";
	const signature = identity.signMessage(msg);

	assertEquals(typeof signature, "string");
	assert(signature.length > 0);
	assert(identity.verifyMessage(msg, signature));
});

Deno.test("Identity: encryption and decryption through encryptionKey", () => {
	const identity = new Identity("dilithium", "kyber");
	const msg = "secret message";
	const ciphertext = identity.encryptionKey.encrypt(msg);

	assertEquals(typeof ciphertext, "string");
	assert(ciphertext.length > 0);
	assertEquals(identity.encryptionKey.decrypt(ciphertext), msg);
});

Deno.test("Identity: toJSON returns valid JSON string", () => {
	const identity = new Identity("dilithium", "kyber");
	const json = identity.toJSON();

	assertEquals(typeof json, "string");
	const parsed = JSON.parse(json);
	assert("signingKey" in parsed);
	assert("encryptionKey" in parsed);
});

Deno.test("Identity: different signing key types produce different fingerprints", () => {
	const dilithiumIdentity = new Identity("dilithium", "kyber");
	const sphincsIdentity = new Identity("sphincs", "kyber");

	// They should both work
	assert(dilithiumIdentity.toFingerprint().startsWith("ebpdk1"));
	assert(sphincsIdentity.toFingerprint().startsWith("ebpsk1"));

	// And be different
	assert(dilithiumIdentity.toFingerprint() !== sphincsIdentity.toFingerprint());
});

Deno.test("Identity: sphincs signing works correctly", () => {
	const identity = new Identity("sphincs", "kyber");
	const msg = "testing sphincs signing";
	const signature = identity.signMessage(msg);

	assert(identity.verifyMessage(msg, signature));
	assert(!identity.verifyMessage("wrong message", signature));
});

Deno.test("Identity: JSON round-trip preserves keys", () => {
	const original = new Identity("dilithium", "kyber");
	const fingerprint = original.toFingerprint();

	// Sign a message with original identity
	const msg = "test message";
	const signature = original.signMessage(msg);

	// Encrypt a message with original identity
	const ciphertext = original.encryptionKey.encrypt(msg);

	// Serialize and restore
	const json = original.toJSON();
	const restored = Identity.fromJSON(json);

	// Fingerprint should be identical (same keys)
	assertEquals(restored.toFingerprint(), fingerprint);

	// Restored identity should verify signatures from original
	assert(restored.verifyMessage(msg, signature));

	// Restored identity should decrypt messages from original
	assertEquals(restored.encryptionKey.decrypt(ciphertext), msg);
});

Deno.test("Identity: fromJSON works with sphincs key type", () => {
	const original = new Identity("sphincs", "kyber");
	const fingerprint = original.toFingerprint();
	const msg = "sphincs test";
	const signature = original.signMessage(msg);

	const json = original.toJSON();
	const restored = Identity.fromJSON(json);

	assertEquals(restored.toFingerprint(), fingerprint);
	assert(restored.verifyMessage(msg, signature));
});

Deno.test("Identity: VerifyDetails validates correct history", () => {
	const identity = new Identity("dilithium", "kyber");

	identity.attachDetail("email", "user@example.com");
	identity.attachDetail("name", "Alice");
	identity.attachDetail("role", "admin");

	// Static verification should pass on untampered details
	const ok = Identity.VerifyDetails(
		(identity as unknown as { details: Map<string, [string, string]> }).details,
	);
	assertEquals(ok, true);

	// Instance method should give the same result
	assertEquals(identity.verifyDetails(), true);
});

Deno.test("Identity: VerifyDetails detects invalid nonce reuse", () => {
	const identity = new Identity("dilithium", "kyber");

	identity.attachDetail("email", "user@example.com");
	identity.attachDetail("name", "Alice");

	const detailsMap = (identity as unknown as { details: Map<string, [string, string]> }).details;

	const emailEntry = detailsMap.get("email");
	const nameEntry = detailsMap.get("name");
	if (!emailEntry || !nameEntry) {
		throw new Error("Expected detail entries to exist");
	}

	// Corrupt the second record to reuse the first record's nonce
	const [nameDetail, nameProof] = nameEntry;
	const [, emailProof] = emailEntry;
	const emailRecordJson = Buffer.from(emailProof, "hex").toString();
	const emailRecord = JSON.parse(emailRecordJson);

	const nameRecordJson = Buffer.from(nameProof, "hex").toString();
	const nameRecord = JSON.parse(nameRecordJson);
	nameRecord.nonce = emailRecord.nonce;

	const corruptedNameProof = Buffer.from(JSON.stringify(nameRecord)).toString("hex");
	detailsMap.set("name", [nameDetail, corruptedNameProof]);

	assertEquals(Identity.VerifyDetails(detailsMap), false);
	assertEquals(identity.verifyDetails(), false);
});

Deno.test("Identity: VerifyDetails detects non-increasing timestamps", () => {
	const identity = new Identity("dilithium", "kyber");

	identity.attachDetail("email", "user@example.com");
	identity.attachDetail("name", "Alice");

	const detailsMap = (identity as unknown as { details: Map<string, [string, string]> }).details;

	const emailEntry = detailsMap.get("email");
	const nameEntry = detailsMap.get("name");
	if (!emailEntry || !nameEntry) {
		throw new Error("Expected detail entries to exist");
	}

	// Force the second record's timestamp to be <= the first one's timestamp
	const [nameDetail, nameProof] = nameEntry;
	const [, emailProof] = emailEntry;

	const emailRecord = JSON.parse(Buffer.from(emailProof, "hex").toString());
	const nameRecord = JSON.parse(Buffer.from(nameProof, "hex").toString());

	nameRecord.timestamp = emailRecord.timestamp;

	const corruptedNameProof = Buffer.from(JSON.stringify(nameRecord)).toString("hex");
	detailsMap.set("name", [nameDetail, corruptedNameProof]);

	assertEquals(Identity.VerifyDetails(detailsMap), false);
	assertEquals(identity.verifyDetails(), false);
});

Deno.test("Identity: attachDetail and getDetail verify proofs", () => {
	const identity = new Identity("dilithium", "kyber");
	const path = "email";
	const value = "user@example.com";

	identity.attachDetail(path, value);

	// Valid proof should return the stored value
	const retrieved = identity.getDetail(path);
	assertEquals(retrieved, value);

	// Tamper with the stored proof to ensure verification fails
	const entry = (identity as unknown as { details: Map<string, [string, string]> }).details.get(path);
	if (!entry) {
		throw new Error("Expected detail entry to exist");
	}

	const [detail, proof] = entry;
	// Flip the first hex character (simple corruption)
	const corruptedProof = (proof[0] === "0" ? "1" : "0") + proof.slice(1);
	(identity as unknown as { details: Map<string, [string, string]> }).details.set(path, [detail, corruptedProof]);

	// Corrupted proof should cause getDetail to return null
	const tampered = identity.getDetail(path);
	assertEquals(tampered, null);
});

Deno.test("Identity: summary can be used to encrypt for identity", () => {
	const identity = new Identity("dilithium", "kyber");
	const external = identity.summary;

	const message = "encrypt via summary";
	const ciphertext = Identity.EncryptFor(external, message);

	assertEquals(typeof ciphertext, "string");
	assert(ciphertext.length > 0);
	assertEquals(identity.encryptionKey.decrypt(ciphertext), message);
});

