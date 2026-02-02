import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { KyberEncryptionKey } from "../core/Kyber.ts";

Deno.test("Kyber: key generation, encrypt, and decrypt", () => {
	const msg = "hello kyber";
	const key = new KyberEncryptionKey();
	const ciphertext = key.encrypt(msg);

	assertEquals(typeof ciphertext, "string");
	assert(ciphertext.length > 0);
	assertEquals(key.decrypt(ciphertext), msg);
});

Deno.test("Kyber: decryption fails with different key", () => {
	const msg = "secret message";
	const key1 = new KyberEncryptionKey();
	const key2 = new KyberEncryptionKey();
	const ciphertext = key1.encrypt(msg);

	// Decrypting with a different key should throw (AES-GCM auth will fail)
	assertThrows(() => {
		key2.decrypt(ciphertext);
	});
});

Deno.test("Kyber: JSON round-trip preserves ability to encrypt and decrypt", () => {
	const msgPast = "past message";
	const key = new KyberEncryptionKey();
	const fingerprint = key.toFingerprint();
	const pk = key.publicKey;
	const ciphertextPast = key.encrypt(msgPast);
	// sanity
	assertEquals(key.decrypt(ciphertextPast), msgPast);

	// serialize and restore
	const json = key.toJSON();
	const restored = KyberEncryptionKey.fromJSON(json);

	// fingerprint should be identical
	assertEquals(restored.toFingerprint(), fingerprint);
	assertEquals(restored.publicKey, pk);

	// restored key should decrypt past ciphertext
	assertEquals(restored.decrypt(ciphertextPast), msgPast);

	// new encryptions from restored key should work
	const msgNew = "new message after restore";
	const ciphertextNew = restored.encrypt(msgNew);
	assertEquals(restored.decrypt(ciphertextNew), msgNew);
});

Deno.test("Kyber: works with all variants", () => {
	const variants = KyberEncryptionKey.listVariants();
	assert(variants.length > 0, "Should have at least one variant");

	for (const variant of variants) {
		const msg = `testing ${variant}`;
		const key = new KyberEncryptionKey(variant);
		assertEquals(key.variant, variant);

		const ciphertext = key.encrypt(msg);
		assertEquals(key.decrypt(ciphertext), msg);
	}
});

Deno.test("Kyber: invalid variant throws error", () => {
	assertThrows(
		() => new KyberEncryptionKey("invalid_variant"),
		Error,
		"Invalid Kyber KEM variant"
	);
});

Deno.test("Kyber: fingerprint is deterministic", () => {
	const key = new KyberEncryptionKey();
	const fp1 = key.toFingerprint();
	const fp2 = key.toFingerprint();

	assertEquals(fp1, fp2);
	// SHA-256 produces 64 hex chars
	assertEquals(fp1.length, 64);
});

Deno.test("Kyber: different keys have different fingerprints", () => {
	const key1 = new KyberEncryptionKey();
	const key2 = new KyberEncryptionKey();

	assert(key1.toFingerprint() !== key2.toFingerprint());
});

