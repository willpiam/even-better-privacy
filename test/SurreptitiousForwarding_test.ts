import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { Identity } from "../core/Identity.ts";

// F-CRYPTO-02: recipient-bound signed envelopes. This test asserts the
// Don Davis "surreptitious forwarding" attack no longer succeeds:
// if Alice signs-and-encrypts to Bob, and an attacker re-encrypts the
// extracted signed payload to Charlie, Charlie's `decryptAndVerify` must
// return `verified: false` / `verifyStatus: "invalid"`.

Deno.test("F-CRYPTO-02: surreptitiously forwarded message fails to verify for Charlie", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const charlie = new Identity("dilithium", "kyber");

	const aliceExt = alice.summary;
	const bobExt = bob.summary;
	const charlieExt = charlie.summary;

	// Alice signs-and-encrypts a message to Bob.
	const ctToBob = alice.signAndEncryptFor("Bob, sell the stock.", bobExt);

	// Bob decrypts, extracts the signed inner JSON.
	const innerRaw = bob.encryptionKey.decrypt(ctToBob);
	const inner = JSON.parse(innerRaw);
	assertEquals(inner.envelopeVersion, 2);

	// Bob verifies (honest path).
	const bobView = bob.decryptAndVerify(ctToBob, aliceExt);
	assertEquals(bobView.verified, true);
	assertEquals(bobView.verifyStatus, "valid");

	// Attacker re-encrypts the (still-signed) inner payload to Charlie.
	const ctToCharlie = Identity.EncryptFor(charlieExt, innerRaw);
	const charlieView = charlie.decryptAndVerify(ctToCharlie, aliceExt);

	// Without recipient binding, this would have returned verified:true.
	// With F-CRYPTO-02, it must be invalid.
	assertEquals(charlieView.verified, false);
	assertEquals(charlieView.verifyStatus, "invalid");
});

Deno.test("F-CRYPTO-02: signAndEncryptMessage also recipient-binds", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");
	const charlie = new Identity("dilithium", "kyber");

	const ct = alice.signAndEncryptMessage("hi bob", bob);
	const innerRaw = bob.encryptionKey.decrypt(ct);
	const inner = JSON.parse(innerRaw);
	assertEquals(inner.envelopeVersion, 2);
	assertEquals(inner.recipientFingerprint, bob.toFingerprint());

	// Forwarding to Charlie must fail to verify.
	const ctToCharlie = Identity.EncryptFor(charlie.summary, innerRaw);
	const charlieView = charlie.decryptAndVerify(ctToCharlie, alice.summary);
	assertEquals(charlieView.verified, false);
});

Deno.test("F-CRYPTO-02: legacy v1 signed payload decrypts as valid_unbound", () => {
	const alice = new Identity("dilithium", "kyber");
	const bob = new Identity("dilithium", "kyber");

	// Simulate a legacy v1 producer: sign over the unbound envelope, then
	// encrypt the v1 inner shape. We do this by calling the pre-F-CRYPTO-02
	// primitives manually.
	const message = "legacy hello";
	const legacySignature = alice.signMessage(message);
	const legacyInner = JSON.stringify({ message, signature: legacySignature });
	const ct = Identity.EncryptFor(bob.summary, legacyInner);

	const view = bob.decryptAndVerify(ct, alice.summary);
	assert(view.verified === true, "legacy v1 signature should still verify");
	assertEquals(view.verifyStatus, "valid_unbound");
});
