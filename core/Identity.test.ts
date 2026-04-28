import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "./Identity.ts";
import type { MultiRecipientAttachmentManifestEntry } from "./MessageHash.ts";
import {
  createRevocationCertificate,
  MAX_REVOCATION_REASON_LENGTH,
} from "./Revocation.ts";
import { MultiRecipientCipher } from "./MultiRecipientCipher.ts";
import { KyberEncryptionKey } from "./Kyber.ts";

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
