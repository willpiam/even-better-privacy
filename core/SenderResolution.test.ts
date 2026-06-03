import { assertEquals } from "jsr:@std/assert";
import {
  externalIdentityFromEmbeddedRecord,
  tryResolveSenderIdentity,
} from "./SenderResolution.ts";
import { Identity } from "./Identity.ts";

Deno.test("externalIdentityFromEmbeddedRecord rejects missing keys", () => {
  assertEquals(
    externalIdentityFromEmbeddedRecord({ signingKeyType: "dilithium" }),
    null,
  );
});

Deno.test("tryResolveSenderIdentity uses embedded when contact missing", async () => {
  const identity = new Identity("dilithium", "kyber");
  const fingerprint = identity.toFingerprint();
  const summary = identity.summary;

  const result = await tryResolveSenderIdentity({
    senderFingerprint: fingerprint,
    embeddedIdentity: {
      fingerprint,
      signingKeyType: summary.signingKeyType,
      encryptionKeyType: summary.encryptionKeyType,
      signingKey: summary.signingKey,
      encryptionKey: summary.encryptionKey,
      signingKeyDetails: summary.signingKeyDetails,
      encryptionKeyDetails: summary.encryptionKeyDetails,
    },
    loadContact: async () => {
      throw new Error("not found");
    },
    fetchFromServer: async () => null,
  });

  assertEquals(result?.isKnownContact, false);
  assertEquals(result?.contact.fingerprint, fingerprint);
});
