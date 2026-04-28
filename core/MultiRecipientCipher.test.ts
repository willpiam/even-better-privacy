import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { Identity } from "./Identity.ts";
import { KyberEncryptionKey } from "./Kyber.ts";
import { MultiRecipientCipher } from "./MultiRecipientCipher.ts";

Deno.test("MultiRecipientCipher: encrypt once and unwrap for each recipient", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const carol = new Identity("sphincs", "kyber");
	const plaintext = new TextEncoder().encode("group message");

	const encrypted = MultiRecipientCipher.encryptForMany(plaintext, [
		alice.summary,
		bob.summary,
		carol.summary,
	]);
	assertEquals(encrypted.recipients.length, 3);

	for (const identity of [alice, bob, carol]) {
		const entry = encrypted.recipients.find((item) => item.fingerprint === identity.toFingerprint());
		assert(entry);
		const contentKey = MultiRecipientCipher.unwrapContentKey(
			entry,
			identity.encryptionKey as unknown as KyberEncryptionKey,
		);
		const decrypted = MultiRecipientCipher.decryptWithContentKey(
			encrypted.ciphertext,
			encrypted.contentNonce,
			contentKey,
		);
		assertEquals(new TextDecoder().decode(decrypted), "group message");
	}
});

Deno.test("MultiRecipientCipher: tampered wrapped key fails unwrap", () => {
	const alice = new Identity("dilithium", "kyber");
	const encrypted = MultiRecipientCipher.encryptForMany(
		new TextEncoder().encode("hello"),
		[alice.summary],
	);
	const [entry] = encrypted.recipients;
	const tampered = {
		...entry,
		wrappedContentKey: `${entry.wrappedContentKey.slice(0, -2)}aa`,
	};
	assertThrows(() => MultiRecipientCipher.unwrapContentKey(
		tampered,
		alice.encryptionKey as unknown as KyberEncryptionKey,
	));
});

Deno.test("MultiRecipientCipher: recipient outside list cannot decrypt", () => {
	const alice = new Identity("dilithium", "kyber");
	const dave = new Identity("dilithium", "kyber");
	const encrypted = MultiRecipientCipher.encryptForMany(
		new TextEncoder().encode("private"),
		[alice.summary],
	);
	const entry = encrypted.recipients.find((item) => item.fingerprint === dave.toFingerprint());
	assertEquals(entry, undefined);
});
