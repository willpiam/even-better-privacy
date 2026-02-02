import { assert, assertEquals } from "jsr:@std/assert";
import { DilithiumSigningKey } from "../core/Dilithium.ts";

Deno.test("Dilithium: key generation, sign, and verify", () => {
	const msg = "hello dilithium";
	const key = new DilithiumSigningKey();
	const signature = key.sign(msg);

	assertEquals(typeof signature, "string");
	assert(signature.length > 0);
	assert(key.verify(msg, signature));
});

Deno.test("Dilithium: static verify with publicKey", () => {
	const msg = "hello";
	const key = new DilithiumSigningKey();
	const signature = key.sign(msg);

	assert(DilithiumSigningKey.verify(key.variant, msg, signature, key.publicKey));
});

Deno.test("Dilithium: verification fails on different message", () => {
	const key = new DilithiumSigningKey();
	const signature = key.sign("message A");

	assert(!key.verify("message B", signature));
});

Deno.test("Dilithium: JSON round-trip preserves ability to verify and sign", () => {
	const msgPast = "past message";
	const key = new DilithiumSigningKey();
	const fingerprint = key.toFingerprint();
	const pk = key.publicKey;
	const variant = key.variant;
	const sigPast = key.sign(msgPast);
	// sanity
	assert(key.verify(msgPast, sigPast));

	// serialize and restore
	const json = key.toJSON();
	const restored = DilithiumSigningKey.fromJSON(json);

	// fingerprint and verification of past signatures should be identical/valid
	assertEquals(restored.toFingerprint(), fingerprint);
	assert(restored.verify(msgPast, sigPast));

	// new signatures from restored key should verify with the same public key
	const msgNew = "new message after restore";
	const sigNew = restored.sign(msgNew);
	assert(DilithiumSigningKey.verify(variant, msgNew, sigNew, pk));
});

