import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "./Identity.ts";
import type { MultiRecipientAttachmentManifestEntry } from "./MessageHash.ts";

Deno.test("Identity multi-recipient: sign once, decrypt and verify", () => {
	const sender = new Identity("dilithium", "kyber");
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("sphincs", "kyber");
	const manifest: MultiRecipientAttachmentManifestEntry[] = [
		{ attachmentId: "att-1", ciphertextSha256: "00".repeat(32) },
	];
	const encrypted = sender.signAndEncryptForMany(
		"team update",
		[alice.summary, bob.summary],
		{ attachmentManifest: manifest },
	);

	const byAlice = alice.decryptAndVerifyMulti({
		recipients: encrypted.recipients,
		contentNonce: encrypted.contentNonce,
		ciphertext: encrypted.ciphertext,
	}, sender.summary);
	assertEquals(byAlice.verified, true);
	assertEquals(byAlice.verifyStatus, "valid");
	assertEquals(byAlice.message, "team update");
	assertEquals(byAlice.attachmentManifest.length, 1);
	assert(byAlice.recipientFingerprints.includes(alice.toFingerprint()));
	assert(byAlice.recipientFingerprints.includes(bob.toFingerprint()));
});

Deno.test("Identity multi-recipient: recipient set binding rejects non-member", () => {
	const sender = new Identity("dilithium", "kyber");
	const alice = new Identity("dilithium", "kyber");
	const outsider = new Identity("dilithium", "kyber");
	const encrypted = sender.signAndEncryptForMany("hello", [alice.summary]);
	const result = outsider.decryptAndVerifyMulti({
		recipients: encrypted.recipients,
		contentNonce: encrypted.contentNonce,
		ciphertext: encrypted.ciphertext,
	}, sender.summary);
	assertEquals(result.verified, false);
	assertEquals(result.verifyStatus, "invalid");
});
