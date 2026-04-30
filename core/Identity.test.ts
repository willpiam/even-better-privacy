import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "./Identity.ts";
import type { MultiRecipientAttachmentManifestEntry } from "./MessageHash.ts";
import {
  createRevocationCertificate,
  MAX_REVOCATION_REASON_LENGTH,
} from "./Revocation.ts";
import { MultiRecipientCipher } from "./MultiRecipientCipher.ts";
import { KyberEncryptionKey } from "./Kyber.ts";
import { AES, StorageFormatError } from "./AES.ts";

Deno.test("Identity multi-recipient: sign once, decrypt and verify", () => {
  const sender = new Identity("dilithium", "kyber");
  const alice = new Identity("dilithium", "kyber");
  const bob = new Identity("sphincs", "kyber");
  const manifest: MultiRecipientAttachmentManifestEntry[] = [
    { attachmentId: "att-1", ciphertextSha256: "00".repeat(32) },
  ];
  const encrypted = sender.signAndEncryptForMany(
    "team update",
    [alice.summary, bob.summary],
    { attachmentManifest: manifest },
  );

  const byAlice = alice.decryptAndVerifyMulti({
    recipients: encrypted.recipients,
    contentNonce: encrypted.contentNonce,
    ciphertext: encrypted.ciphertext,
  }, sender.summary);
  assertEquals(byAlice.verified, true);
  assertEquals(byAlice.verifyStatus, "valid");
  assertEquals(byAlice.message, "team update");
  assertEquals(byAlice.attachmentManifest.length, 1);
  assert(byAlice.recipientFingerprints.includes(alice.toFingerprint()));
  assert(byAlice.recipientFingerprints.includes(bob.toFingerprint()));
});

Deno.test("Identity multi-recipient: recipient set binding rejects non-member", () => {
  const sender = new Identity("dilithium", "kyber");
  const alice = new Identity("dilithium", "kyber");
  const outsider = new Identity("dilithium", "kyber");
  const encrypted = sender.signAndEncryptForMany("hello", [alice.summary]);
  const result = outsider.decryptAndVerifyMulti({
    recipients: encrypted.recipients,
    contentNonce: encrypted.contentNonce,
    ciphertext: encrypted.ciphertext,
  }, sender.summary);
  assertEquals(result.verified, false);
  assertEquals(result.verifyStatus, "invalid");
});

Deno.test("Identity encrypted-signed inner payloads include explicit type tags", () => {
  const sender = new Identity("dilithium", "kyber");
  const recipient = new Identity("dilithium", "kyber");

  const ciphertext = sender.signAndEncryptMessage("hello", recipient);
  const parsed = JSON.parse(recipient.encryptionKey.decrypt(ciphertext));

  assertEquals(parsed.type, "ebp-encrypted-signed-inner");
  assertEquals(parsed.envelopeVersion, 2);
  assertEquals(parsed.message, "hello");
});

Deno.test("Identity.fromStorageFormat initializes constructor-backed state", () => {
  const original = new Identity("dilithium", "kyber");
  original.attachDetail("email", "alice@example.com");
  const storage = original.toStorageFormat("correct horse battery staple");

  const loaded = Identity.fromStorageFormat(storage);

  assert(loaded instanceof Identity);
  assertEquals(loaded.isPrivateLoaded, false);
  assertEquals(loaded.signingKeyType, "dilithium");
  assertEquals(loaded.encryptionKeyType, "kyber");
  assertEquals(loaded.toFingerprint(), original.toFingerprint());
  assertEquals(loaded.detailsNonce, original.detailsNonce);
  assertEquals(loaded.revocationNonce, original.revocationNonce);
  assertEquals(loaded.revokedDetails.size, 0);
  assertEquals(loaded.revocationCertificate, null);
});

Deno.test("F-STORAGE-07: password-loaded identities are private-loaded", () => {
  const original = new Identity("dilithium", "kyber");
  const password = "correct horse battery staple";
  const loaded = Identity.fromStorageFormat(
    original.toStorageFormat(password),
    password,
  );

  assertEquals(loaded.isPrivateLoaded, true);
  assertEquals(typeof loaded.signMessage, "function");
});

Deno.test("Identity storage private payload binds key types to public metadata", () => {
  const original = new Identity("dilithium", "kyber");
  const storage = JSON.parse(
    original.toStorageFormat("correct horse battery staple"),
  );
  storage.public.signingKeyType = "sphincs";

  let error: unknown;
  try {
    Identity.fromStorageFormat(
      JSON.stringify(storage),
      "correct horse battery staple",
    );
  } catch (e) {
    error = e;
  }

  assert(error instanceof StorageFormatError);
  assert(
    error.message.includes("signing key type does not match"),
  );
});

Deno.test("Identity storage legacy private payload loads and requests upgrade", () => {
  const original = new Identity("dilithium", "kyber");
  const password = "correct horse battery staple";
  const storage = JSON.parse(original.toStorageFormat(password));
  const legacyPrivateData = {
    signingKey: original.signingKey.toJSON(),
    encryptionKey: original.encryptionKey.toJSON(),
  };
  storage.encrypted = AES.encrypt(
    password,
    JSON.stringify(legacyPrivateData),
    "ebp:identity-storage:v2",
  );

  const loaded = Identity.fromStorageFormat(JSON.stringify(storage), password);

  assertEquals(loaded.toFingerprint(), original.toFingerprint());
  assertEquals(Identity.needsPrivateKeyTypeStorageUpgrade(loaded), true);
});

Deno.test("Identity multi-recipient inner payload includes explicit type tag", () => {
  const sender = new Identity("dilithium", "kyber");
  const recipient = new Identity("dilithium", "kyber");
  const encrypted = sender.signAndEncryptForMany("hello", [recipient.summary]);
  const contentKey = MultiRecipientCipher.unwrapContentKey(
    encrypted.recipients[0],
    recipient.encryptionKey as KyberEncryptionKey,
  );
  const decrypted = MultiRecipientCipher.decryptWithContentKey(
    encrypted.ciphertext,
    encrypted.contentNonce,
    contentKey,
  );
  const parsed = JSON.parse(new TextDecoder().decode(decrypted));

  assertEquals(parsed.type, "ebp-encrypted-signed-inner-multi");
  assertEquals(parsed.envelopeVersion, 3);
  assertEquals(parsed.message, "hello");
});

Deno.test("Revocation certificate reason length is capped", () => {
  const tooLong = "x".repeat(MAX_REVOCATION_REASON_LENGTH + 1);

  let rejected = false;
  try {
    createRevocationCertificate("identity", "fp", 0, { reason: tooLong });
  } catch {
    rejected = true;
  }
  assert(rejected);
});
