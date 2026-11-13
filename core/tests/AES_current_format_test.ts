import { assertEquals, assertThrows } from "jsr:@std/assert";
import { AES, StorageFormatError } from "../AES.ts";
import { Identity } from "../Identity.ts";
import { base64ToBytes, bytesToBase64 } from "../Base64.ts";

Deno.test("AES and all identity readers reject obsolete ciphertext formats", () => {
  const key = new Uint8Array(32);
  const salt = new Uint8Array(16);
  const identity = new Identity("dilithium", "kyber");
  const storage = JSON.parse(identity.toStorageFormatWithKey(key, salt));
  assertEquals(AES.readHeader(storage.encrypted).version, 4);
  for (const version of [0, 1, 2, 3, 5]) {
    const bytes = base64ToBytes(storage.encrypted);
    bytes[0] = version;
    const encoded = bytesToBase64(bytes);
    assertThrows(
      () => AES.readHeader(encoded),
      StorageFormatError,
      "Unsupported ciphertext version",
    );
    assertThrows(() => AES.decrypt("password", encoded), StorageFormatError);
    assertThrows(() => AES.decryptWithKey(key, encoded), StorageFormatError);
    assertThrows(
      () => AES.deriveKeyForStorage("password", salt, version),
      StorageFormatError,
    );
    const obsolete = JSON.stringify({ ...storage, encrypted: encoded });
    assertThrows(
      () => Identity.fromStorageFormatWithKey(obsolete, key),
      StorageFormatError,
    );
    assertThrows(
      () => Identity.fromStorageFormat(obsolete),
      StorageFormatError,
    );
    assertEquals(Identity.readPublicData(obsolete), null);
  }
});

Deno.test("identity readers require the stored details nonce instead of inferring old state", () => {
  const identity = new Identity("dilithium", "kyber");
  const key = new Uint8Array(32);
  const storage = JSON.parse(
    identity.toStorageFormatWithKey(key, new Uint8Array(16)),
  );
  const json = JSON.parse(identity.toJSON());
  for (const nonce of [undefined, null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    json.detailsNonce = nonce;
    assertThrows(
      () => Identity.fromJSON(JSON.stringify(json)),
      StorageFormatError,
      "details nonce",
    );
    storage.public.detailsNonce = nonce;
    const raw = JSON.stringify(storage);
    assertThrows(
      () => Identity.fromStorageFormat(raw),
      StorageFormatError,
      "details nonce",
    );
    assertThrows(
      () => Identity.fromStorageFormatWithKey(raw, key),
      StorageFormatError,
      "details nonce",
    );
    assertEquals(Identity.readPublicData(raw), null);
  }
});
