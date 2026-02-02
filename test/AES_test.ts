import { AES } from "../core/AES.ts";
import {
	assertEquals,
	assertNotEquals,
	assertRejects,
} from "jsr:@std/assert";

Deno.test("AES encrypt/decrypt roundtrip simple string", async () => {
	const password = "correct horse battery staple";
	const plaintext = "hello world";

	const ciphertext = await AES.encrypt(password, plaintext);
	const decrypted = await AES.decrypt(password, ciphertext);

	assertEquals(decrypted, plaintext);
});

Deno.test("AES encrypt/decrypt roundtrip with unicode", async () => {
	const password = "🔑 пароль 密码";
	const plaintext = "Emoji: 😀👍🏻, Accents: café naïve, CJK: 漢字";

	const ciphertext = await AES.encrypt(password, plaintext);
	const decrypted = await AES.decrypt(password, ciphertext);

	assertEquals(decrypted, plaintext);
});

Deno.test("AES decrypt fails with wrong password", async () => {
	const password = "password-1";
	const wrongPassword = "password-2";
	const plaintext = "secret message";

	const ciphertext = await AES.encrypt(password, plaintext);

	await assertRejects(
		() => AES.decrypt(wrongPassword, ciphertext),
		Error,
		"Decryption failed",
	);
});

Deno.test("AES encryption is randomized (different ciphertexts)", async () => {
	const password = "same-password";
	const plaintext = "same message";

	const c1 = await AES.encrypt(password, plaintext);
	const c2 = await AES.encrypt(password, plaintext);

	assertNotEquals(c1, c2);
});

Deno.test("AES decrypt rejects invalid payload", async () => {
	await assertRejects(
		() => AES.decrypt("pw", "not-base64@@"),
		Error,
	);

	// Too short once base64-decoded (e.g. empty string)
	const emptyEncoded = "";
	await assertRejects(
		() => AES.decrypt("pw", emptyEncoded),
		Error,
		"Invalid ciphertext",
	);
});


