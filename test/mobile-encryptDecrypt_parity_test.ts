import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
} from "../core/Payloads.ts";
import {
  createFileCleartextEnvelope,
  parseFileCleartextEnvelope,
} from "../core/FilePayload.ts";
import {
  isEncryptedMessageType,
  isEncryptedSignedMessageType,
  normalizeFileUri,
  publicIdentityBlock,
  requireCiphertext,
  senderFieldsFromPayload,
} from "../mobile/src/services/encryptDecryptLogic.ts";

Deno.test("mobile encryptDecrypt: normalizeFileUri and ciphertext helpers", () => {
  assertEquals(normalizeFileUri("file:///data/x"), "/data/x");
  assertEquals(requireCiphertext({ ciphertext: "zz" }), "zz");
  assertThrows(() => requireCiphertext({}), Error, "ciphertext");
  assertEquals(isEncryptedMessageType("ebp-encrypted-message"), true);
  assertEquals(isEncryptedSignedMessageType("ebp-encrypted-signed-message"), true);
});

Deno.test("mobile encryptDecrypt: publicIdentityBlock + unsigned roundtrip", () => {
  const alice = new Identity("dilithium", "kyber");
  const bob = new Identity("dilithium", "kyber");
  const block = publicIdentityBlock(alice);
  assertEquals(block.fingerprint, alice.toFingerprint());
  assert(typeof block.signingKey === "string" && String(block.signingKey).length > 0);

  const message = "hello encrypt parity";
  const ciphertext = Identity.EncryptFor(bob.summary, message);
  const payload = buildEncryptedMessagePayload({
    recipientFingerprint: bob.toFingerprint(),
    ciphertext,
  }) as Record<string, unknown>;
  assertEquals(payload.type, "ebp-encrypted-message");
  assertEquals(
    bob.encryptionKey.decrypt(requireCiphertext(payload)),
    message,
  );
});

Deno.test("mobile encryptDecrypt: signed message + sender fields", () => {
  const alice = new Identity("dilithium", "kyber");
  const bob = new Identity("dilithium", "kyber");
  const message = "signed encrypt parity";
  const ciphertext = alice.signAndEncryptFor(message, bob.summary);
  const payload = buildEncryptedSignedMessagePayload({
    recipientFingerprint: bob.toFingerprint(),
    senderFingerprint: alice.toFingerprint(),
    ciphertext,
    senderIdentity: publicIdentityBlock(alice),
  }) as Record<string, unknown>;

  const fields = senderFieldsFromPayload(payload);
  assertEquals(fields.senderFingerprint, alice.toFingerprint());
  assert(fields.embeddedIdentity);
  assertEquals(
    fields.embeddedIdentity!.fingerprint,
    alice.toFingerprint(),
  );

  const result = bob.decryptAndVerify(ciphertext, alice.summary);
  assertEquals(result.message, message);
  assertEquals(result.verified, true);
});

Deno.test("mobile encryptDecrypt: file envelope roundtrip", () => {
  const bytes = new TextEncoder().encode("file-bytes");
  const envelope = createFileCleartextEnvelope(bytes, "note.txt", "text/plain");
  const cleartext = JSON.stringify(envelope);
  const parsed = parseFileCleartextEnvelope(cleartext);
  assertEquals(parsed.fileName, "note.txt");
  assertEquals(parsed.mimeType, "text/plain");
  assertEquals(parsed.fileSize, bytes.length);
  assertEquals(new TextDecoder().decode(parsed.fileBytes), "file-bytes");
});
