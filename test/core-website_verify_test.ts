import { assert, assertEquals } from "jsr:@std/assert";
import { buildFileSignMessage } from "../core/CryptoUtils.ts";
import { Identity } from "../core/Identity.ts";
import { sha256Hex } from "../core/MessageHash.ts";
import {
  buildDetachedSignaturePayload,
  buildSignedMessagePayload,
} from "../core/Payloads.ts";
import {
  computeIdentityFingerprint,
  sha256Hex as websiteSha256Hex,
  verifySignature,
} from "../website/crypto.js";

// core/ signs with Identity.signMessage and builds payloads in Payloads.ts.
// The website page needs a browser DOM, so this test calls website/crypto.js
// the way website/verify.js does. The website does not create signatures.

const MESSAGE = "core to website compatibility\nline two";
const FILE_TEXT = "core website file\n";
const FILE_CONTEXT = "notes";
const FILE_SALT = "a1b2c3d4e5f67890";

type JsonRecord = Record<string, unknown>;

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

function publicIdentity(identity: Identity): JsonRecord {
  return identity.summary as unknown as JsonRecord;
}

function signedMessage(identity: Identity, salt: string): JsonRecord {
  return buildSignedMessagePayload({
    fingerprint: identity.toFingerprint(),
    message: MESSAGE,
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature: identity.signMessage(MESSAGE, salt),
    identity: publicIdentity(identity),
  }) as unknown as JsonRecord;
}

function detachedSignature(identity: Identity, salt: string): JsonRecord {
  return buildDetachedSignaturePayload({
    fingerprint: identity.toFingerprint(),
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature: identity.signMessage(MESSAGE, salt),
    identity: publicIdentity(identity),
  }) as unknown as JsonRecord;
}

function signedFile(identity: Identity, fileSalt: string): JsonRecord {
  const fileHash = sha256Hex(FILE_TEXT);
  const signed = buildFileSignMessage(fileHash, fileSalt, FILE_CONTEXT);
  return {
    type: "ebp-signed-file",
    fileName: "notes.txt",
    fileHash,
    salt: fileSalt,
    contextMessage: FILE_CONTEXT,
    fingerprint: identity.toFingerprint(),
    signature: identity.signMessage(signed),
    identity: publicIdentity(identity),
  };
}

function websiteVerify(
  identity: JsonRecord,
  payload: JsonRecord,
  message: string,
): boolean {
  return verifySignature(identity, {
    message,
    messageHash: payload.messageHash,
    salt: payload.salt ?? "",
    signature: payload.signature,
  });
}

function websiteVerifyFile(identity: JsonRecord, payload: JsonRecord): boolean {
  const reconstructed = buildFileSignMessage(
    String(payload.fileHash ?? ""),
    String(payload.salt ?? ""),
    String(payload.contextMessage ?? ""),
  );
  return verifySignature(identity, {
    message: reconstructed,
    messageHash: websiteSha256Hex(reconstructed),
    salt: "",
    signature: payload.signature,
  });
}

Deno.test("core signatures verify in the website verifier", async (t) => {
  for (const signing of ["dilithium", "sphincs"] as const) {
    await t.step(`${signing}: attached, unsalted, and detached`, () => {
      const identity = new Identity(signing, "kyber");
      const exported = publicIdentity(identity);

      const attached = signedMessage(identity, FILE_SALT);
      assertEquals(attached.type, "ebp-signed-message");
      assertEquals(attached.fingerprint, exported.fingerprint);
      assert(
        websiteVerify(exported, attached, MESSAGE),
        `website rejected a salted core ${signing} signature`,
      );
      assert(
        verifySignature(exported, {
          message: MESSAGE,
          salt: attached.salt,
          signature: attached.signature,
        }),
        `website rejected a salted core ${signing} message when recomputing the hash`,
      );

      const unsalted = signedMessage(identity, "");
      assertEquals(unsalted.salt, "");
      assert(
        websiteVerify(exported, unsalted, MESSAGE),
        `website rejected an unsalted core ${signing} signature`,
      );

      const detached = detachedSignature(identity, FILE_SALT);
      assertEquals(detached.type, "ebp-signature");
      assert(
        websiteVerify(exported, detached, MESSAGE),
        `website rejected a detached core ${signing} signature`,
      );

      assertEquals(
        websiteVerify(exported, {
          ...attached,
          signature: tamperSignature(String(attached.signature)),
        }, MESSAGE),
        false,
        `website accepted a tampered core ${signing} signature`,
      );
    });
  }
});

Deno.test("core signed file verifies in the website verifier", () => {
  const identity = new Identity("dilithium", "kyber");
  const exported = publicIdentity(identity);
  const salted = signedFile(identity, FILE_SALT);
  assertEquals(salted.type, "ebp-signed-file");
  assert(
    websiteVerifyFile(exported, salted),
    "website rejected a core ebp-signed-file payload",
  );
  const unsalted = signedFile(identity, "");
  assertEquals(unsalted.salt, "");
  assert(
    websiteVerifyFile(exported, unsalted),
    "website rejected an unsalted core ebp-signed-file payload",
  );
});

Deno.test("core public identity fingerprint matches the website verifier", () => {
  for (const signing of ["dilithium", "sphincs"] as const) {
    const identity = new Identity(signing, "kyber");
    const exported = publicIdentity(identity);
    assertEquals(
      computeIdentityFingerprint(exported),
      exported.fingerprint,
      `website fingerprint helper disagreed with a core ${signing} identity`,
    );
  }
});
