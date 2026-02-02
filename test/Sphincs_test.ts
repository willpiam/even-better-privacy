import { assert, assertEquals } from "jsr:@std/assert";
import { SphincsSigningKey } from "../core/Sphincs.ts";

Deno.test("Sphincs: key generation, sign, and verify", () => {
	const msg = "hello sphincs";
	const key = new SphincsSigningKey();
	const signature = key.sign(msg);

	assertEquals(typeof signature, "string");
	assert(signature.length > 0);
	assert(key.verify(msg, signature));
});

Deno.test("Sphincs: static verify with publicKey", () => {
	const msg = "hello";
	const key = new SphincsSigningKey();
	const signature = key.sign(msg);

	assert(SphincsSigningKey.verify(key.variant, msg, signature, key.publicKey));
});

Deno.test("Sphincs: verification fails on different message", () => {
	const key = new SphincsSigningKey();
	const signature = key.sign("message A");

	assert(!key.verify("message B", signature));
});

Deno.test("Sphincs: JSON round-trip preserves ability to verify and sign", () => {
	const msgPast = "past message";
	const key = new SphincsSigningKey();
	const fingerprint = key.toFingerprint();
	const pk = key.publicKey;
	const variant = key.variant;
	const sigPast = key.sign(msgPast);
	// sanity
	assert(key.verify(msgPast, sigPast));

	// serialize and restore
	const json = key.toJSON();
	const restored = SphincsSigningKey.fromJSON(json);

	// fingerprint and verification of past signatures should be identical/valid
	assertEquals(restored.toFingerprint(), fingerprint);
	assert(restored.verify(msgPast, sigPast));

	// new signatures from restored key should verify with the same public key
	const msgNew = "new message after restore";
	const sigNew = restored.sign(msgNew);
	assert(SphincsSigningKey.verify(variant, msgNew, sigNew, pk));
});


