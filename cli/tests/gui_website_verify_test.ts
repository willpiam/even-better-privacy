import { assert, assertEquals } from "jsr:@std/assert";
import { buildFileSignMessage } from "../../core/CryptoUtils.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { handleRequest } from "../../gui/local-backend/routes.ts";
import { getCsrfToken, initSecurity } from "../../gui/local-backend/security.ts";
import {
  computeIdentityFingerprint,
  sha256Hex as websiteSha256Hex,
  verifySignature,
} from "../../website/crypto.js";

// The GUI signs through POST /api/v1/sign. File signatures are assembled in
// gui/app.js after that call. The website page needs a browser DOM, so this
// test calls website/crypto.js the way website/verify.js does. The website
// does not create signatures.

const PASSWORD = "Gui-website-test1";
const MESSAGE = "GUI to website compatibility\nline two";
const FILE_BYTES = new TextEncoder().encode("gui website file\n");
const FILE_CONTEXT = "notes";

type JsonRecord = Record<string, unknown>;

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

async function guiPost(
  path: string,
  body: JsonRecord,
): Promise<{ status: number; body: JsonRecord }> {
  const req = new Request(`http://127.0.0.1:8787${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "host": "127.0.0.1:8787",
      "x-ebp-csrf": getCsrfToken(),
    },
    body: JSON.stringify(body),
  });
  const res = await handleRequest(req);
  const parsed = await res.json();
  return { status: res.status, body: parsed as JsonRecord };
}

function signConfirmation(message: string): JsonRecord {
  return {
    approved: true,
    approvedAt: Date.now(),
    messageHash: sha256Hex(message),
  };
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
    messageHash: websiteSha256Hex(reconstructed),
    salt: "",
    signature: payload.signature,
  });
}

async function generate(
  home: string,
  name: string,
  signingType: "dilithium" | "sphincs",
): Promise<void> {
  const res = await guiPost("/api/v1/identity/generate", {
    home,
    name,
    password: PASSWORD,
    signingType,
    encryptionType: "kyber",
  });
  assertEquals(res.status, 201, JSON.stringify(res.body));
}

async function exportPublic(
  home: string,
  identity: string,
): Promise<JsonRecord> {
  const res = await guiPost("/api/v1/identity/export-public", {
    home,
    identity,
    password: PASSWORD,
    includeDetails: true,
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function signMessage(
  home: string,
  identity: string,
  options: { detached?: boolean; includeSalt?: boolean },
): Promise<JsonRecord> {
  const res = await guiPost("/api/v1/sign", {
    home,
    identity,
    password: PASSWORD,
    message: MESSAGE,
    detached: options.detached ?? false,
    includeSalt: options.includeSalt ?? true,
    includeIdentity: true,
    signConfirmation: signConfirmation(MESSAGE),
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

// Mirrors gui/app.js sign-file-form: hash the file in the page, then ask
// /api/v1/sign for a detached signature over ebp::filehash::... with an
// empty signature salt. The file salt lives inside that hashed string.
async function signFile(
  home: string,
  identity: string,
  fileSalt: string,
): Promise<JsonRecord> {
  const fileHash = await sha256HexBytes(FILE_BYTES);
  const signedMessage = buildFileSignMessage(fileHash, fileSalt, FILE_CONTEXT);
  const res = await guiPost("/api/v1/sign", {
    home,
    identity,
    password: PASSWORD,
    message: signedMessage,
    detached: true,
    includeIdentity: true,
    includeSalt: false,
    signConfirmation: signConfirmation(signedMessage),
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return {
    type: "ebp-signed-file",
    fileName: "notes.txt",
    fileHash,
    salt: fileSalt,
    contextMessage: FILE_CONTEXT,
    fingerprint: res.body.fingerprint,
    signature: res.body.signature,
    identity: res.body.identity,
  };
}

Deno.test("GUI signatures verify in the website verifier", async (t) => {
  await initSecurity({ persist: false, host: "127.0.0.1", port: 8787 });
  const home = await Deno.makeTempDir({ prefix: "ebp-gui-web-" });
  try {
    await generate(home, "alice", "dilithium");
    await generate(home, "carol", "sphincs");
    const alice = await exportPublic(home, "alice");
    const carol = await exportPublic(home, "carol");

    await t.step("dilithium attached, unsalted, and detached", async () => {
      const attached = await signMessage(home, "alice", {});
      assertEquals(attached.type, "ebp-signed-message");
      assertEquals(attached.fingerprint, alice.fingerprint);
      assert(
        websiteVerify(alice, attached, MESSAGE),
        "website rejected a salted GUI signature",
      );
      assert(
        verifySignature(alice, {
          message: MESSAGE,
          salt: attached.salt,
          signature: attached.signature,
        }),
        "website rejected a salted GUI message when recomputing the hash",
      );

      const unsalted = await signMessage(home, "alice", { includeSalt: false });
      assertEquals(unsalted.salt, "");
      assert(
        websiteVerify(alice, unsalted, MESSAGE),
        "website rejected an unsalted GUI signature",
      );

      const detached = await signMessage(home, "alice", { detached: true });
      assertEquals(detached.type, "ebp-signature");
      assert(
        websiteVerify(alice, detached, MESSAGE),
        "website rejected a detached GUI signature",
      );

      assertEquals(
        websiteVerify(alice, {
          ...attached,
          signature: tamperSignature(String(attached.signature)),
        }, MESSAGE),
        false,
        "website accepted a tampered GUI signature",
      );
    });

    await t.step("sphincs attached", async () => {
      const attached = await signMessage(home, "carol", { includeSalt: false });
      assert(
        websiteVerify(carol, attached, MESSAGE),
        "website rejected a GUI SPHINCS+ signature",
      );
    });

    await t.step("signed file", async () => {
      const salted = await signFile(home, "alice", "a1b2c3d4e5f67890");
      assertEquals(salted.type, "ebp-signed-file");
      assert(
        websiteVerifyFile(alice, salted),
        "website rejected a GUI ebp-signed-file payload",
      );
      const unsalted = await signFile(home, "alice", "");
      assert(
        websiteVerifyFile(alice, unsalted),
        "website rejected an unsalted GUI ebp-signed-file payload",
      );
    });

    await t.step("fingerprint", () => {
      assertEquals(
        computeIdentityFingerprint(alice),
        alice.fingerprint,
        "website fingerprint helper disagreed with a GUI Dilithium export",
      );
      assertEquals(
        computeIdentityFingerprint(carol),
        carol.fingerprint,
        "website fingerprint helper disagreed with a GUI SPHINCS+ export",
      );
    });
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
