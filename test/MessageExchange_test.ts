import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";

Deno.test("Alice and Bob: exchange signed encrypted messages using external identities", () => {
	// Create identities for Alice and Bob
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");

	// Exchange external identities (public keys only - no private keys shared)
	const aliceExternal = alice.summary;
	const bobExternal = bob.summary;

	// Verify they don't have access to each other's private keys
	assert(!("secretKey" in aliceExternal));
	assert(!("secretKey" in bobExternal));

	// Alice sends a signed and encrypted message to Bob
	const aliceMessage = "Hello Bob, this is a secret message from Alice!";
	const aliceToBob = alice.signAndEncryptFor(aliceMessage, bobExternal);

	// Bob sends a signed and encrypted message to Alice
	const bobMessage = "Hi Alice, got your message! Here's my secret reply.";
	const bobToAlice = bob.signAndEncryptFor(bobMessage, aliceExternal);

	// Bob decrypts and verifies Alice's message using his private key and Alice's external identity
	const fromAlice = bob.decryptAndVerify(aliceToBob, aliceExternal);
	assertEquals(fromAlice.message, aliceMessage);
	assertEquals(fromAlice.verified, true);

	// Alice decrypts and verifies Bob's message using her private key and Bob's external identity
	const fromBob = alice.decryptAndVerify(bobToAlice, bobExternal);
	assertEquals(fromBob.message, bobMessage);
	assertEquals(fromBob.verified, true);
});

Deno.test("Alice and Bob: sphincs signing key variant", () => {
	// Test with sphincs signing keys instead of dilithium
	const alice = new Identity("sphincs", "kyber");
	const bob = new Identity("sphincs", "kyber");

	const aliceExternal = alice.summary;
	const bobExternal = bob.summary;

	const aliceMessage = "Secret message with sphincs signatures";
	const aliceToBob = alice.signAndEncryptFor(aliceMessage, bobExternal);

	const bobMessage = "Reply with sphincs signatures";
	const bobToAlice = bob.signAndEncryptFor(bobMessage, aliceExternal);

	const fromAlice = bob.decryptAndVerify(aliceToBob, aliceExternal);
	assertEquals(fromAlice.message, aliceMessage);
	assertEquals(fromAlice.verified, true);

	const fromBob = alice.decryptAndVerify(bobToAlice, bobExternal);
	assertEquals(fromBob.message, bobMessage);
	assertEquals(fromBob.verified, true);
});

Deno.test("Alice and Bob: mixed signing key types", () => {
	// Alice uses dilithium, Bob uses sphincs
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("sphincs", "kyber");

	const aliceExternal = alice.summary;
	const bobExternal = bob.summary;

	const aliceMessage = "Message from dilithium user";
	const aliceToBob = alice.signAndEncryptFor(aliceMessage, bobExternal);

	const bobMessage = "Reply from sphincs user";
	const bobToAlice = bob.signAndEncryptFor(bobMessage, aliceExternal);

	const fromAlice = bob.decryptAndVerify(aliceToBob, aliceExternal);
	assertEquals(fromAlice.message, aliceMessage);
	assertEquals(fromAlice.verified, true);

	const fromBob = alice.decryptAndVerify(bobToAlice, bobExternal);
	assertEquals(fromBob.message, bobMessage);
	assertEquals(fromBob.verified, true);
});

Deno.test("Alice and Bob: tampered message fails verification", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");

	const aliceExternal = alice.summary;
	const bobExternal = bob.summary;

	// Alice creates a message for Bob
	const aliceMessage = "Important message";
	const aliceToBob = alice.signAndEncryptFor(aliceMessage, bobExternal);

	// Bob successfully decrypts and verifies
	const fromAlice = bob.decryptAndVerify(aliceToBob, aliceExternal);
	assertEquals(fromAlice.verified, true);

	// Now let's create a scenario where Bob tries to verify with wrong sender
	// Create a third party "Eve"
	const eve = new Identity("dilithium", "kyber");
	const eveExternal = eve.summary;

	// Bob tries to verify Alice's message as if it came from Eve - should fail
	const wrongSender = bob.decryptAndVerify(aliceToBob, eveExternal);
	assertEquals(wrongSender.verified, false);
});

Deno.test("Alice and Bob: cannot decrypt messages meant for someone else", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const eve = new Identity("dilithium", "kyber");

	const bobExternal = bob.summary;
	const aliceExternal = alice.summary;

	// Alice encrypts a message for Bob
	const secretMessage = "This is only for Bob!";
	const aliceToBob = alice.signAndEncryptFor(secretMessage, bobExternal);

	// Bob can decrypt it
	const fromAliceToBob = bob.decryptAndVerify(aliceToBob, aliceExternal);
	assertEquals(fromAliceToBob.message, secretMessage);
	assertEquals(fromAliceToBob.verified, true);

	// Eve cannot decrypt it (will throw an error during decryption)
	let eveFailed = false;
	try {
		eve.decryptAndVerify(aliceToBob, aliceExternal);
	} catch {
		eveFailed = true;
	}
	assert(eveFailed, "Eve should not be able to decrypt Bob's message");
});

Deno.test("Alice and Bob: signed but not encrypted message", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const eve = new Identity("dilithium", "kyber");

	const aliceExternal = alice.summary;

	// Alice signs a public message (not encrypted - anyone can read it)
	const publicMessage = "This is a public announcement from Alice!";
	const signature = alice.signMessage(publicMessage);

	// Bob can verify the message came from Alice using her external identity
	const bobVerifies = Identity.VerifySignature(aliceExternal, publicMessage, signature);
	assertEquals(bobVerifies, true);

	// Eve can also verify - the message is public, anyone can read and verify it
	const eveVerifies = Identity.VerifySignature(aliceExternal, publicMessage, signature);
	assertEquals(eveVerifies, true);

	// But if someone tries to claim Alice said something else, verification fails
	const tamperedMessage = "Alice said something else!";
	const tamperedVerifies = Identity.VerifySignature(aliceExternal, tamperedMessage, signature);
	assertEquals(tamperedVerifies, false);

	// And if Eve tries to forge a signature, Bob can detect it
	const eveForgedSignature = eve.signMessage(publicMessage);
	const forgedVerifies = Identity.VerifySignature(aliceExternal, publicMessage, eveForgedSignature);
	assertEquals(forgedVerifies, false);
});

Deno.test("Alice and Bob: signed but not encrypted with sphincs", () => {
	const alice = new Identity("sphincs", "kyber");
	const bob = new Identity("sphincs", "kyber");

	const aliceExternal = alice.summary;

	const publicMessage = "Sphincs signed public message";
	const signature = alice.signMessage(publicMessage);

	// Bob verifies using Alice's external identity
	const verified = Identity.VerifySignature(aliceExternal, publicMessage, signature);
	assertEquals(verified, true);

	// Tampered message fails verification
	const tamperedVerifies = Identity.VerifySignature(aliceExternal, "wrong message", signature);
	assertEquals(tamperedVerifies, false);
});

Deno.test("Alice and Bob: encrypted but not signed message", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const eve = new Identity("dilithium", "kyber");

	const bobExternal = bob.summary;

	// Alice encrypts a message for Bob without signing it
	const secretMessage = "Anonymous secret for Bob";
	const ciphertext = Identity.EncryptFor(bobExternal, secretMessage);

	// Bob can decrypt the message
	const decrypted = bob.encryptionKey.decrypt(ciphertext);
	assertEquals(decrypted, secretMessage);

	// Eve cannot decrypt the message
	let eveFailed = false;
	try {
		eve.encryptionKey.decrypt(ciphertext);
	} catch {
		eveFailed = true;
	}
	assert(eveFailed, "Eve should not be able to decrypt Bob's message");

	// Note: Bob has no way to verify who sent this message since it's not signed
	// This is useful for anonymous tips or plausible deniability scenarios
});

Deno.test("Alice and Bob: encrypted but not signed - sender anonymity", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const eve = new Identity("dilithium", "kyber");

	const bobExternal = bob.summary;

	// Both Alice and Eve send anonymous encrypted messages to Bob
	const aliceMessage = "Secret tip from an anonymous source";
	const eveMessage = "Another secret tip";

	const fromAlice = Identity.EncryptFor(bobExternal, aliceMessage);
	const fromEve = Identity.EncryptFor(bobExternal, eveMessage);

	// Bob can decrypt both messages
	assertEquals(bob.encryptionKey.decrypt(fromAlice), aliceMessage);
	assertEquals(bob.encryptionKey.decrypt(fromEve), eveMessage);

	// But Bob cannot tell which message came from Alice vs Eve
	// (there's no signature to verify - that's the point of unsigned messages)
});

