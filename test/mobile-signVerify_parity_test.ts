import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import { buildFileSignMessage } from "../core/CryptoUtils.ts";
import {
  resolveFileSignSalt,
  resolveSignSalt,
  signMessageWithIdentity,
  verifyMessagePayload,
  signFileBytesWithIdentity,
} from "../mobile/src/services/signVerifyLogic.ts";

Deno.test("mobile signVerify parity: includeSalt false → empty salt; verify works", () => {
  const identity = new Identity("dilithium", "kyber");
  const message = "parity salt-off message";

  const unsalted = signMessageWithIdentity(identity, message, {
    includeSalt: false,
    includeIdentity: true,
  });
  assertEquals(unsalted.salt, "");
  assertEquals(
    verifyMessagePayload({
      payload: unsalted,
      publicIdentity: identity.summary,
    }).verified,
    true,
  );

  const salted = signMessageWithIdentity(identity, message, {
    includeSalt: true,
    includeIdentity: true,
  });
  assert(typeof salted.salt === "string" && salted.salt.length > 0);
  assert(salted.signature !== unsalted.signature);

  const saltedAgain = signMessageWithIdentity(identity, message, {
    includeSalt: true,
    includeIdentity: true,
  });
  // Different random salts → different signatures
  assert(salted.salt !== saltedAgain.salt);
});

Deno.test("mobile signVerify parity: resolveSignSalt explicit + empty message", () => {
  assertEquals(resolveSignSalt({ includeSalt: false }), "");
  assertEquals(resolveSignSalt({ salt: "fixedsalt" }), "fixedsalt");
  assertEquals(resolveFileSignSalt(false), "");
  assert(resolveFileSignSalt(true).length > 0);
  assertThrows(
    () => signMessageWithIdentity(new Identity("dilithium", "kyber"), ""),
    Error,
    "Message is required",
  );
});

Deno.test("mobile signVerify parity: file salt off", () => {
  const identity = new Identity("dilithium", "kyber");
  const fileBytes = new TextEncoder().encode("file-bytes-for-parity");
  const context = "ctx";

  const result = signFileBytesWithIdentity({
    identity,
    fileBytes,
    fileName: "parity.bin",
    contextMessage: context,
    includeSalt: false,
  });

  assertEquals(result.salt, "");
  assertEquals(result.payload.salt, "");
  assertEquals(
    result.signedMessage,
    buildFileSignMessage(result.fileHash, "", context),
  );
  assertEquals(
    result.signedMessage,
    `ebp::filehash::${result.fileHash}::::${context}`,
  );
  assert(
    Identity.VerifySignature(
      identity.summary,
      result.signedMessage,
      String(result.payload.signature),
      "",
    ),
  );
});

Deno.test(
  "mobile signVerify parity: public keys verify (detached, includeIdentity false)",
  () => {
    const identity = new Identity("dilithium", "kyber");
    const message = "Detached verification check";

    const payload = signMessageWithIdentity(identity, message, {
      detached: true,
      includeIdentity: false,
      includeSalt: false,
    });

    assertEquals(payload.type, "ebp-signature");
    assertEquals(payload.identity, undefined);
    assertEquals(payload.salt, "");

    const ok = verifyMessagePayload({
      payload,
      message,
      publicIdentity: identity.summary,
    });
    assertEquals(ok.verified, true);

    const tampered = {
      ...payload,
      signature: String(payload.signature).slice(0, -2) + "00",
    };
    const bad = verifyMessagePayload({
      payload: tampered,
      message,
      publicIdentity: identity.summary,
    });
    assertEquals(bad.verified, false);

    assertThrows(
      () => {
        verifyMessagePayload({
          payload,
          message,
          publicIdentity: {
            ...identity.summary,
            signingKey: "",
          },
        });
      },
      Error,
      "signing key",
    );
  },
);
