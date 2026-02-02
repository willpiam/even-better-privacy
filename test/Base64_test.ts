import { bytesToBase64, base64ToBytes } from "../core/Base64.ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("bytesToBase64 encodes empty and simple ASCII", () => {
	const enc = new TextEncoder();
	// Empty
	assertEquals(bytesToBase64(new Uint8Array()), "");
	// "f" -> "Zg=="
	assertEquals(bytesToBase64(enc.encode("f")), "Zg==");
	// "fo" -> "Zm8="
	assertEquals(bytesToBase64(enc.encode("fo")), "Zm8=");
	// "foo" -> "Zm9v"
	assertEquals(bytesToBase64(enc.encode("foo")), "Zm9v");
	// "hello world" -> "aGVsbG8gd29ybGQ="
	assertEquals(bytesToBase64(enc.encode("hello world")), "aGVsbG8gd29ybGQ=");
});

Deno.test("base64ToBytes decodes known vectors", () => {
	const dec = new TextDecoder();
	assertEquals(dec.decode(base64ToBytes("")), "");
	assertEquals(dec.decode(base64ToBytes("Zg==")), "f");
	assertEquals(dec.decode(base64ToBytes("Zm8=")), "fo");
	assertEquals(dec.decode(base64ToBytes("Zm9v")), "foo");
	assertEquals(dec.decode(base64ToBytes("aGVsbG8gd29ybGQ=")), "hello world");
});

Deno.test("roundtrip bytes -> base64 -> bytes", () => {
	// Some hand-picked byte patterns including boundaries
	const samples: Uint8Array[] = [
		new Uint8Array([]),
		new Uint8Array([0]),
		new Uint8Array([255]),
		new Uint8Array([0, 255, 254, 1, 2, 253]),
		// Sequential 0..255
		Uint8Array.from({ length: 256 }, (_, i) => i),
	];
	for (const sample of samples) {
		const b64 = bytesToBase64(sample);
		const back = base64ToBytes(b64);
		assertEquals(back, sample);
	}
});

Deno.test("base64ToBytes throws on invalid base64", () => {
	// Invalid length
	assertThrows(() => base64ToBytes("A"));
	// Invalid characters
	assertThrows(() => base64ToBytes("??"));
	// Bad padding
	assertThrows(() => base64ToBytes("Zg="));
});


