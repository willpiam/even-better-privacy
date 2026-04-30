import { AES, DecryptionAuthError, StorageFormatError } from "../core/AES.ts";
import { assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert";

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
    DecryptionAuthError,
    "Wrong password or tampered ciphertext",
  );
});

Deno.test("AES decrypt fails with auth error for tampered ciphertext", () => {
  const ciphertext = AES.encrypt("password", "secret message");
  const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  bytes[bytes.length - 1] ^= 0x01;
  const tampered = btoa(String.fromCharCode(...bytes));

  assertThrows(
    () => AES.decrypt("password", tampered),
    DecryptionAuthError,
  );
});

Deno.test("AES encryption is randomized (different ciphertexts)", () => {
  const password = "same-password";
  const plaintext = "same message";

  const c1 = AES.encrypt(password, plaintext);
  const c2 = AES.encrypt(password, plaintext);

  assertNotEquals(c1, c2);
});

Deno.test("F-STORAGE-03: AES-GCM AAD binds storage metadata", () => {
  const ciphertext = AES.encrypt("password", "secret message", "format:v1");

  assertEquals(
    AES.decrypt("password", ciphertext, "format:v1"),
    "secret message",
  );
  assertThrows(
    () => AES.decrypt("password", ciphertext, "format:v2"),
    DecryptionAuthError,
  );
});

Deno.test("AES decrypt rejects invalid payload", () => {
  assertThrows(
    () => AES.decrypt("pw", "not-base64@@"),
    StorageFormatError,
  );

  // Too short once base64-decoded (e.g. empty string)
  const emptyEncoded = "";
  assertThrows(
    () => AES.decrypt("pw", emptyEncoded),
    StorageFormatError,
    "Invalid ciphertext",
  );
});
