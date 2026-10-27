import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import { buildFileSignMessage } from "../core/CryptoUtils.ts";
import {
  signFileBytesWithIdentity,
  signMessageWithIdentity,
} from "../mobile/src/services/signVerifyLogic.ts";
import {
  computeIdentityFingerprint,
  sha256Hex,
  verifySignature,
} from "../website/crypto.js";

// Mobile signs through signVerifyLogic.ts, which the app screens call.
// The website page needs a browser DOM, so this test calls website/crypto.js
// with the same arguments website/verify.js passes. The website does not
// create signatures, so the checked direction is mobile → website.

const MESSAGE = "Mobile to website compatibility\nline two";
const FILE_BYTES = new TextEncoder().encode("mobile website file\n");
const FILE_CONTEXT = "notes";

type JsonRecord = Record<string, unknown>;

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

function websiteVerify(
  publicIdentity: JsonRecord,
  payload: JsonRecord,
  message: string,
): boolean {
  return verifySignature(publicIdentity, {
    message,
    messageHash: payload.messageHash,
    salt: payload.salt ?? "",
    signature: payload.signature,
  });
}

function websiteVerifyFile(
  publicIdentity: JsonRecord,
  payload: JsonRecord,
): boolean {
  const reconstructed = buildFileSignMessage(
    String(payload.fileHash ?? ""),
    String(payload.salt ?? ""),
    String(payload.contextMessage ?? ""),
  );
  return verifySignature(publicIdentity, {
    message: reconstructed,
    messageHash: sha256Hex(reconstructed),
    salt: "",
    signature: payload.signature,
  });
}

Deno.test("mobile signatures verify in the website verifier", async (t) => {
  for (const signing of ["dilithium", "sphincs"] as const) {
    await t.step(`${signing}: attached, unsalted, and detached`, () => {
      const identity = new Identity(signing, "kyber");
      const publicIdentity = identity.summary as unknown as JsonRecord;

      const attached = signMessageWithIdentity(identity, MESSAGE, {
        includeIdentity: true,
      });
      assertEquals(attached.type, "ebp-signed-message");
      assertEquals(attached.fingerprint, publicIdentity.fingerprint);
      assertEquals(attached.message, MESSAGE);
      assert(
        websiteVerify(publicIdentity, attached, MESSAGE),
        `website rejected a salted mobile ${signing} signature`,
      );
      assert(
        verifySignature(publicIdentity, {
          message: MESSAGE,
          salt: attached.salt,
          signature: attached.signature,
        }),
        `website rejected a salted mobile ${signing} message when recomputing the hash`,
      );

      const unsalted = signMessageWithIdentity(identity, MESSAGE, {
        includeSalt: false,
        includeIdentity: false,
      });
      assertEquals(unsalted.salt, "");
      assert(
        websiteVerify(publicIdentity, unsalted, MESSAGE),
        `website rejected an unsalted mobile ${signing} signature`,
      );

      const detached = signMessageWithIdentity(identity, MESSAGE, {
        detached: true,
        includeIdentity: true,
      });
      assertEquals(detached.type, "ebp-signature");
      assert(
        websiteVerify(publicIdentity, detached, MESSAGE),
        `website rejected a detached mobile ${signing} signature`,
      );

      assertEquals(
        websiteVerify(publicIdentity, {
          ...attached,
          signature: tamperSignature(String(attached.signature)),
        }, MESSAGE),
        false,
        `website accepted a tampered mobile ${signing} signature`,
      );
    });
  }
});

Deno.test("mobile signed file verifies in the website verifier", () => {
  const identity = new Identity("dilithium", "kyber");
  const publicIdentity = identity.summary as unknown as JsonRecord;
  const signed = signFileBytesWithIdentity({
    identity,
    fileBytes: FILE_BYTES,
    fileName: "notes.txt",
    contextMessage: FILE_CONTEXT,
    includeSalt: true,
  });
  assertEquals(signed.payload.type, "ebp-signed-file");
  assertEquals(
    signed.signedMessage,
    buildFileSignMessage(signed.fileHash, signed.salt, FILE_CONTEXT),
  );
  assert(
    websiteVerifyFile(publicIdentity, signed.payload),
    "website rejected a mobile ebp-signed-file payload",
  );

  const unsalted = signFileBytesWithIdentity({
    identity,
    fileBytes: FILE_BYTES,
    fileName: "notes.txt",
    contextMessage: FILE_CONTEXT,
    includeSalt: false,
  });
  assertEquals(unsalted.salt, "");
  assert(
    websiteVerifyFile(publicIdentity, unsalted.payload),
    "website rejected an unsalted mobile ebp-signed-file payload",
  );
});

Deno.test("mobile public identity fingerprint matches the website verifier", () => {
  for (const signing of ["dilithium", "sphincs"] as const) {
    const identity = new Identity(signing, "kyber");
    const publicIdentity = identity.summary as unknown as JsonRecord;
    assertEquals(
      computeIdentityFingerprint(publicIdentity),
      publicIdentity.fingerprint,
      `website fingerprint helper disagreed with a mobile ${signing} identity`,
    );
  }
});
