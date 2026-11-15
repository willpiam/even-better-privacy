import { assertEquals, assertThrows } from "@std/assert";
import { AES, DecryptionAuthError, StorageFormatError } from "../AES.ts";
import { getIdentityStorageAad, Identity } from "../Identity.ts";
import { DilithiumSigningKey } from "../Dilithium.ts";
import { hexToString, stringToHex } from "../Hex.ts";

Deno.test("storage v3 authenticates every part of the public identity snapshot", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("name", "Alice");
  identity.createIdentityRevocation();
  const key = new Uint8Array(32).fill(7);
  const raw = identity.toStorageFormatWithKey(key, new Uint8Array(16));
  assertEquals(JSON.parse(raw).version, 3);
  for (
    const mutate of [
      (pub: Record<string, unknown>) => {
        pub.detailsNonce = 0;
      },
      (pub: Record<string, unknown>) => {
        pub.revocationNonce = 0;
      },
      (pub: Record<string, unknown>) => {
        delete pub.revocationCertificate;
      },
      (pub: Record<string, unknown>) => {
        pub.revokedDetails = { name: "forged" };
      },
      (pub: Record<string, unknown>) => {
        pub.details = {};
      },
      (pub: Record<string, unknown>) => {
        pub.hdProvenance = { path: "forged" };
      },
    ]
  ) {
    const storage = JSON.parse(raw);
    mutate(storage.public);
    assertThrows(
      () => Identity.fromStorageFormatWithKey(JSON.stringify(storage), key),
      DecryptionAuthError,
    );
  }
  const downgraded = JSON.parse(raw);
  downgraded.version = 2;
  assertThrows(
    () => Identity.fromStorageFormatWithKey(JSON.stringify(downgraded), key),
    DecryptionAuthError,
  );
});

Deno.test("legacy v2 remains readable and upgrades to authenticated v3 on save", () => {
  const original = new Identity("dilithium", "kyber");
  const key = new Uint8Array(32).fill(7), salt = new Uint8Array(16);
  const storage = JSON.parse(original.toStorageFormatWithKey(key, salt));
  const plaintext = AES.decryptWithKey(
    key,
    storage.encrypted,
    getIdentityStorageAad(storage.public),
  );
  storage.version = 2;
  storage.encrypted = AES.encryptWithKey(
    key,
    plaintext,
    salt,
    getIdentityStorageAad(storage.public, 2),
  );
  const loaded = Identity.fromStorageFormatWithKey(
    JSON.stringify(storage),
    key,
  );
  assertEquals(loaded.toFingerprint(), original.toFingerprint());
  assertEquals(JSON.parse(loaded.toStorageFormatWithKey(key, salt)).version, 3);
});

Deno.test("storage key self-tests are cached only for unchanged authenticated private keys", () => {
  const original = new Identity("dilithium", "kyber");
  const key = new Uint8Array(32).fill(5), salt = new Uint8Array(16);
  const raw = original.toStorageFormatWithKey(key, salt);
  const sign = DilithiumSigningKey.prototype.sign;
  let calls = 0;
  DilithiumSigningKey.prototype.sign = function (message) {
    calls++;
    return sign.call(this, message);
  };
  try {
    const loaded = Identity.fromStorageFormatWithKey(raw, key);
    Identity.fromStorageFormatWithKey(raw, key);
    loaded.detailsNonce++;
    Identity.fromStorageFormatWithKey(
      loaded.toStorageFormatWithKey(key, salt),
      key,
    );
    assertEquals(calls, 1);
    const storage = JSON.parse(raw);
    const aad = getIdentityStorageAad(storage.public);
    const privateData = JSON.parse(
      AES.decryptWithKey(key, storage.encrypted, aad),
    );
    const signing = JSON.parse(privateData.signingKey);
    const bytes = Uint8Array.from(
      atob(signing.secretKey),
      (c) => c.charCodeAt(0),
    );
    bytes[0] ^= 1;
    signing.secretKey = btoa(String.fromCharCode(...bytes));
    privateData.signingKey = JSON.stringify(signing);
    storage.encrypted = AES.encryptWithKey(
      key,
      JSON.stringify(privateData),
      salt,
      aad,
    );
    assertThrows(
      () => Identity.fromStorageFormatWithKey(JSON.stringify(storage), key),
      StorageFormatError,
    );
    assertEquals(calls, 2);
  } finally {
    DilithiumSigningKey.prototype.sign = sign;
  }
});

Deno.test("instance detail verification rejects a forged signature", () => {
  const identity = new Identity("dilithium", "kyber");
  identity.attachDetail("name", "Alice");
  const proof = JSON.parse(hexToString(identity.details.get("name")![1]));
  proof.detail = "Mallory";
  proof.signature = "forged";
  identity.details.set("name", [
    proof.detail,
    stringToHex(JSON.stringify(proof)),
  ]);
  assertEquals(Identity.ValidateDetailsStructure(identity.details), true);
  assertEquals(identity.verifyDetails(), false);
});

Deno.test("multiple valid details may share a millisecond timestamp", () => {
  const identity = new Identity("dilithium", "kyber"), now = Date.now;
  Date.now = () => 12345;
  try {
    identity.attachDetail("name", "Alice");
    identity.attachDetail("role", "Engineer");
  } finally {
    Date.now = now;
  }
  assertEquals(identity.verifyDetails(), true);
});
