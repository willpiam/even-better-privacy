import { assert, assertEquals, assertThrows } from "jsr:@std/assert@^1.0.6";
import * as dsa from "@noble/post-quantum/ml-dsa";
import * as slh from "@noble/post-quantum/slh-dsa";
import * as kem from "@noble/post-quantum/ml-kem";
import { DilithiumSigningKey } from "../Dilithium.ts";
import { SphincsSigningKey } from "../Sphincs.ts";
import { KyberEncryptionKey } from "../Kyber.ts";
import { Identity } from "../Identity.ts";

function withoutKeyGeneration(run: () => void): void {
  const implementations = [
    ...Object.values(dsa),
    ...Object.values(slh),
    ...Object.values(kem),
  ]
    .filter((value) => value && typeof value === "object" && "keygen" in value);
  const originals = implementations.map((impl) =>
    Object.getOwnPropertyDescriptor(impl, "keygen")!
  );
  try {
    for (const impl of implementations) {
      Object.defineProperty(impl, "keygen", {
        value: () => {
          throw new Error("deserialization must not generate keys");
        },
      });
    }
    run();
  } finally {
    implementations.forEach((impl, i) =>
      Object.defineProperty(impl, "keygen", originals[i])
    );
  }
}

for (const signingType of ["dilithium", "sphincs"] as const) {
  Deno.test(`${signingType}: identity JSON and storage restore keys without key generation`, () => {
    const original = new Identity(signingType, "kyber");
    const key = new Uint8Array(32).fill(7);
    const storage = original.toStorageFormatWithKey(
      key,
      new Uint8Array(16).fill(8),
    );
    withoutKeyGeneration(() => {
      const restored = Identity.fromJSON(original.toJSON());
      assert(restored instanceof Identity);
      assertEquals(restored.toFingerprint(), original.toFingerprint());
      assertEquals(restored.isPrivateLoaded, true);
      assertEquals(restored.details.size, 0);
      assertEquals(restored.revokedDetails.size, 0);
      assertEquals(restored.revocationNonce, 0);
      assertEquals(restored.revocationCertificate, null);

      const publicOnly = Identity.fromStorageFormat(storage);
      assertEquals(publicOnly.isPrivateLoaded, false);
      assertEquals(publicOnly.toFingerprint(), original.toFingerprint());

      const privateLoaded = Identity.fromStorageFormatWithKey(storage, key);
      assertEquals(privateLoaded.isPrivateLoaded, true);
      assertEquals(privateLoaded.toFingerprint(), original.toFingerprint());
      const signature = privateLoaded.signMessage("restored key");
      assert(original.verifyMessage("restored key", signature));
      assertEquals(
        privateLoaded.encryptionKey.decrypt(
          publicOnly.encryptionKey.encrypt("restored encryption"),
        ),
        "restored encryption",
      );
    });
  });
}

Deno.test("key deserialization retains variant validation", () => {
  for (
    const KeyType of [
      DilithiumSigningKey,
      SphincsSigningKey,
      KyberEncryptionKey,
    ]
  ) {
    for (const variant of ["invalid-variant", "", null]) {
      assertThrows(
        () =>
          KeyType.fromJSON(
            JSON.stringify({ variant, publicKey: "", secretKey: "" }),
          ),
        Error,
        "Invalid",
      );
    }
  }
});
