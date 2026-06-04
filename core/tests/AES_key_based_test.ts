import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { randomBytes } from "@noble/hashes/utils";
import { AES, AES_SALT_LENGTH } from "../AES.ts";
import { Identity } from "../Identity.ts";
import { base64ToBytes } from "../Base64.ts";

Deno.test("AES encryptWithKey/decryptWithKey round-trip", () => {
  const key = randomBytes(32);
  const salt = randomBytes(AES_SALT_LENGTH);
  const plaintext = '{"signingKey":"x","encryptionKey":"y"}';
  const aad = "ebp:identity-storage:v2";
  const enc = AES.encryptWithKey(key, plaintext, salt, aad);
  assertEquals(AES.decryptWithKey(key, enc, aad), plaintext);
});

Deno.test("AES key-based path matches password-based encrypt/decrypt", () => {
  const password = "test-password-12chars";
  const plaintext = "secret payload for parity";
  const aad = "ebp:test-aad";
  const enc = AES.encrypt(password, plaintext, aad);
  const { version, salt } = AES.readHeader(enc);
  const key = AES.deriveKeyForStorage(password, salt, version);
  assertEquals(AES.decryptWithKey(key, enc, aad), plaintext);
  assertEquals(AES.decrypt(password, enc, aad), plaintext);
});

Deno.test("Identity toStorageFormatWithKey round-trip matches password path", () => {
  const password = "MobileParityTest1!";
  const identity = new Identity("dilithium", "kyber");
  const viaPassword = identity.toStorageFormat(password);
  const parsed = JSON.parse(viaPassword);
  const { salt } = AES.readHeader(parsed.encrypted);
  const version = AES.getCiphertextVersion(parsed.encrypted);
  const key = AES.deriveKeyForStorage(password, salt, version);

  const viaKey = identity.toStorageFormatWithKey(key, salt);
  const loadedPassword = Identity.fromStorageFormat(viaPassword, password);
  const loadedKey = Identity.fromStorageFormatWithKey(viaKey, key);

  assertEquals(loadedKey.toFingerprint(), loadedPassword.toFingerprint());
  // ML-DSA signatures are randomized; verify both identities can sign.
  const msg = "parity-check-message";
  assert(loadedKey.signMessage(msg).length > 0);
  assert(loadedPassword.signMessage(msg).length > 0);
});

Deno.test("fromStorageFormatWithKey matches fromStorageFormat for same blob", () => {
  const password = "AnotherTestPass12!";
  const identity = new Identity("dilithium", "kyber");
  const storage = identity.toStorageFormat(password);
  const parsed = JSON.parse(storage);
  const { salt } = AES.readHeader(parsed.encrypted);
  const version = AES.getCiphertextVersion(parsed.encrypted);
  const key = AES.deriveKeyForStorage(password, salt, version);

  const fromPw = Identity.fromStorageFormat(storage, password);
  const fromKey = Identity.fromStorageFormatWithKey(storage, key);
  assertEquals(fromKey.toFingerprint(), fromPw.toFingerprint());
});
