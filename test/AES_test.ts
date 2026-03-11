import { AES } from "../core/AES.ts";
import {
	assertEquals,
	assertNotEquals,
	assertThrows,
} from "jsr:@std/assert";

Deno.test("AES encrypt/decrypt roundtrip simple string", () => {
	const password = "correct horse battery staple";
	const plaintext = "hello world";

	const ciphertext = AES.encrypt(password, plaintext);
	const decrypted = AES.decrypt(password, ciphertext);

	assertEquals(decrypted, plaintext);
});

Deno.test("AES encrypt/decrypt roundtrip with unicode", () => {
	const password = "🔑 пароль 密码";
	const plaintext = "Emoji: 😀👍🏻, Accents: café naïve, CJK: 漢字";

	const ciphertext = AES.encrypt(password, plaintext);
	const decrypted = AES.decrypt(password, ciphertext);

	assertEquals(decrypted, plaintext);
});

Deno.test("AES decrypt fails with wrong password", () => {
	const password = "password-1";
	const wrongPassword = "password-2";
	const plaintext = "secret message";

	const ciphertext = AES.encrypt(password, plaintext);

	assertThrows(
		() => AES.decrypt(wrongPassword, ciphertext),
		Error,
		"Decryption failed",
	);
});

Deno.test("AES encryption is randomized (different ciphertexts)", () => {
	const password = "same-password";
	const plaintext = "same message";

	const c1 = AES.encrypt(password, plaintext);
	const c2 = AES.encrypt(password, plaintext);

	assertNotEquals(c1, c2);
});

Deno.test("AES decrypt rejects invalid payload", () => {
	assertThrows(
		() => AES.decrypt("pw", "not-base64@@"),
		Error,
	);

	// Too short once base64-decoded (e.g. empty string)
	const emptyEncoded = "";
	assertThrows(
		() => AES.decrypt("pw", emptyEncoded),
		Error,
		"Invalid ciphertext",
	);
});
