import { assert, assertEquals } from "jsr:@std/assert";
import type { ExternalIdentity } from "../core/ExternalIdentity.ts";
import { Identity } from "../core/Identity.ts";
import { sha256Hex } from "../core/MessageHash.ts";
import {
  buildDetachedSignaturePayload,
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
  buildSignedMessagePayload,
} from "../core/Payloads.ts";
import {
  decryptMessageWithIdentity,
  encryptMessageWithIdentity,
} from "../mobile/src/services/encryptDecryptLogic.ts";
import {
  signMessageWithIdentity,
  verifyMessagePayload,
} from "../mobile/src/services/signVerifyLogic.ts";

// core/ builds payloads with Identity and Payloads.ts. Mobile checks and
// produces payloads through the helpers the app screens call. Both run in
// one Deno process. This is not a device run.

const MESSAGE = "core mobile compatibility\nline two";
const SALT = "a1b2c3d4e5f67890";

type JsonRecord = Record<string, unknown>;

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

function asExternal(identity: Identity): ExternalIdentity {
  return identity.summary;
}

function asRecord(value: unknown): JsonRecord {
  return value as JsonRecord;
}

function coreSignedMessage(identity: Identity, salt: string): JsonRecord {
  return asRecord(buildSignedMessagePayload({
    fingerprint: identity.toFingerprint(),
    message: MESSAGE,
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature: identity.signMessage(MESSAGE, salt),
  }));
}

function coreDetached(identity: Identity, salt: string): JsonRecord {
  return asRecord(buildDetachedSignaturePayload({
    fingerprint: identity.toFingerprint(),
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature: identity.signMessage(MESSAGE, salt),
  }));
}

function mobileVerify(
  payload: JsonRecord,
  sender: ExternalIdentity,
  message?: string,
): boolean {
  return verifyMessagePayload({
    payload,
    publicIdentity: sender,
    ...(message === undefined ? {} : { message }),
  }).verified;
}

function coreVerifies(
  sender: ExternalIdentity,
  payload: JsonRecord,
  message = MESSAGE,
): void {
  assertEquals(
    Identity.VerifySignature(
      sender,
      message,
      String(payload.signature),
      String(payload.salt ?? ""),
    ),
    true,
  );
}

Deno.test("core and mobile accept each other's payloads", () => {
  const alice = new Identity("dilithium", "kyber");
  const bob = new Identity("dilithium", "kyber");
  const carol = new Identity("sphincs", "kyber");
  const alicePublic = asExternal(alice);
  const bobPublic = asExternal(bob);
  const carolPublic = asExternal(carol);

  const attached = coreSignedMessage(alice, SALT);
  assertEquals(attached.type, "ebp-signed-message");
  assert(
    mobileVerify(attached, alicePublic),
    "mobile rejected a salted core signature",
  );
  assertEquals(
    mobileVerify({
      ...attached,
      signature: tamperSignature(String(attached.signature)),
    }, alicePublic),
    false,
    "mobile accepted a tampered core signature",
  );

  const unsalted = coreSignedMessage(alice, "");
  assertEquals(unsalted.salt, "");
  assert(
    mobileVerify(unsalted, alicePublic),
    "mobile rejected an unsalted core signature",
  );

  const detached = coreDetached(alice, SALT);
  assertEquals(detached.type, "ebp-signature");
  assert(
    mobileVerify(detached, alicePublic, MESSAGE),
    "mobile rejected a detached core signature",
  );

  const sphincs = coreSignedMessage(carol, "");
  assert(
    mobileVerify(sphincs, carolPublic),
    "mobile rejected a core SPHINCS+ signature",
  );

  const mobileAttached = signMessageWithIdentity(alice, MESSAGE, {
    includeIdentity: true,
    salt: SALT,
  });
  assertEquals(mobileAttached.type, "ebp-signed-message");
  assertEquals(mobileAttached.fingerprint, alice.toFingerprint());
  coreVerifies(alicePublic, mobileAttached);
  assertEquals(
    Identity.VerifySignature(
      alicePublic,
      MESSAGE,
      tamperSignature(String(mobileAttached.signature)),
      String(mobileAttached.salt ?? ""),
    ),
    false,
  );

  const mobileUnsalted = signMessageWithIdentity(alice, MESSAGE, {
    includeSalt: false,
  });
  assertEquals(mobileUnsalted.salt, "");
  coreVerifies(alicePublic, mobileUnsalted);

  const mobileDetached = signMessageWithIdentity(alice, MESSAGE, {
    detached: true,
    includeIdentity: true,
    salt: SALT,
  });
  assertEquals(mobileDetached.type, "ebp-signature");
  coreVerifies(alicePublic, mobileDetached);

  const mobileSphincs = signMessageWithIdentity(carol, MESSAGE, {
    includeSalt: false,
  });
  coreVerifies(carolPublic, mobileSphincs);

  const coreUnsigned = asRecord(buildEncryptedMessagePayload({
    recipientFingerprint: bob.toFingerprint(),
    ciphertext: Identity.EncryptFor(bobPublic, MESSAGE),
  }));
  const mobileDecryptUnsigned = decryptMessageWithIdentity({
    identity: bob,
    payload: coreUnsigned,
  });
  assertEquals(mobileDecryptUnsigned.message, MESSAGE);
  assertEquals(mobileDecryptUnsigned.verifyStatus, "unsigned");

  const mobileUnsigned = encryptMessageWithIdentity({
    message: MESSAGE,
    recipient: bobPublic,
  });
  assertEquals(mobileUnsigned.type, "ebp-encrypted-message");
  assertEquals(
    bob.encryptionKey.decrypt(String(mobileUnsigned.ciphertext)),
    MESSAGE,
  );

  const coreSigned = asRecord(buildEncryptedSignedMessagePayload({
    recipientFingerprint: bob.toFingerprint(),
    senderFingerprint: alice.toFingerprint(),
    ciphertext: alice.signAndEncryptFor(MESSAGE, bobPublic),
  }));
  const mobileDecryptSigned = decryptMessageWithIdentity({
    identity: bob,
    payload: coreSigned,
    sender: alicePublic,
  });
  assertEquals(mobileDecryptSigned.message, MESSAGE);
  assertEquals(mobileDecryptSigned.verified, true);

  const mobileSigned = encryptMessageWithIdentity({
    message: MESSAGE,
    recipient: bobPublic,
    identity: alice,
    sign: true,
  });
  assertEquals(mobileSigned.type, "ebp-encrypted-signed-message");
  const coreDecryptSigned = bob.decryptAndVerify(
    String(mobileSigned.ciphertext),
    alicePublic,
  );
  assertEquals(coreDecryptSigned.message, MESSAGE);
  assertEquals(coreDecryptSigned.verified, true);
});
