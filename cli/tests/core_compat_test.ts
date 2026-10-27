import { assert, assertEquals } from "jsr:@std/assert";
import { Identity, type ExternalIdentity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
  buildDetachedSignaturePayload,
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessagePayload,
  buildSignedMessagePayload,
} from "../../core/Payloads.ts";
import { handleRequest } from "../../gui/local-backend/routes.ts";
import { getCsrfToken, initSecurity } from "../../gui/local-backend/security.ts";

// CLI and GUI both call core/. These tests still cross the process and HTTP
// boundaries: a payload written by one side is checked by the other's public
// verify/decrypt entry point.

const PASSWORD = "Cli-core-test-pass1";
const MESSAGE = "core compatibility\nline two";
const CLI = new URL("../main.ts", import.meta.url).pathname;

type CliResult = { code: number; stdout: string; stderr: string };
type JsonRecord = Record<string, unknown>;

function cliCommand(home: string, args: string[]): Deno.Command {
  return new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-net",
      CLI,
      "--home",
      home,
      ...args,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
}

async function drain(
  stream: ReadableStream<Uint8Array>,
  into: { text: string },
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    into.text += decoder.decode(value);
  }
}

async function runCli(
  home: string,
  args: string[],
  stdin = "",
): Promise<CliResult> {
  const child = cliCommand(home, args).spawn();
  const stdout = { text: "" };
  const stderr = { text: "" };
  const reading = Promise.all([
    drain(child.stdout, stdout),
    drain(child.stderr, stderr),
  ]);
  const writer = child.stdin.getWriter();
  if (stdin) await writer.write(new TextEncoder().encode(stdin));
  await writer.close();
  const status = await child.status;
  await reading;
  return { code: status.code, stdout: stdout.text, stderr: stderr.text };
}

function assertCliOk(result: CliResult, label: string): void {
  assertEquals(
    result.code,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

async function generateIdentity(
  home: string,
  name: string,
  signing: "dilithium" | "sphincs",
): Promise<void> {
  const child = cliCommand(home, [
    "generate",
    name,
    "--signing",
    signing,
  ]).spawn();
  const stdout = { text: "" };
  const stderr = { text: "" };
  const reading = Promise.all([
    drain(child.stdout, stdout),
    drain(child.stderr, stderr),
  ]);
  const writer = child.stdin.getWriter();
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`${PASSWORD}\n`));
  const started = Date.now();
  while (!stdout.text.includes("Confirm password")) {
    if (Date.now() - started > 180_000) {
      try {
        child.kill();
      } catch {
        // already exited
      }
      await child.status;
      await reading;
      throw new Error(
        `generate did not ask to confirm password\nstdout:\n${stdout.text}\nstderr:\n${stderr.text}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await writer.write(encoder.encode(`${PASSWORD}\n`));
  await writer.close();
  const status = await child.status;
  await reading;
  assertEquals(
    status.code,
    0,
    `generate ${name} failed\nstdout:\n${stdout.text}\nstderr:\n${stderr.text}`,
  );
}

function parseJsonStdout(result: CliResult, label: string): JsonRecord {
  assertCliOk(result, label);
  return JSON.parse(result.stdout);
}

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

function asExternal(value: JsonRecord): ExternalIdentity {
  return value as unknown as ExternalIdentity;
}

async function loadStored(home: string, name: string): Promise<Identity> {
  const raw = await Deno.readTextFile(`${home}/.ebp/${name}.identity.json`);
  return Identity.fromStorageFormat(raw, PASSWORD);
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

function coreSignedMessage(identity: Identity, salt: string): JsonRecord {
  const signature = identity.signMessage(MESSAGE, salt);
  return buildSignedMessagePayload({
    fingerprint: identity.toFingerprint(),
    message: MESSAGE,
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature,
  }) as unknown as JsonRecord;
}

function coreDetached(identity: Identity, salt: string): JsonRecord {
  const signature = identity.signMessage(MESSAGE, salt);
  return buildDetachedSignaturePayload({
    fingerprint: identity.toFingerprint(),
    messageHash: sha256Hex(MESSAGE),
    salt,
    signature,
  }) as unknown as JsonRecord;
}

async function prepareHome(
  prefix: string,
): Promise<{ home: string; alice: Identity; bob: Identity; carol: Identity }> {
  const home = await Deno.makeTempDir({ prefix });
  await generateIdentity(home, "alice", "dilithium");
  await generateIdentity(home, "bob", "dilithium");
  await generateIdentity(home, "carol", "sphincs");
  const alice = await loadStored(home, "alice");
  const bob = await loadStored(home, "bob");
  const carol = await loadStored(home, "carol");
  for (const name of ["alice", "bob", "carol"] as const) {
    const exported = parseJsonStdout(
      await runCli(home, [
        "--identity",
        name,
        "--password",
        PASSWORD,
        "export-public",
      ]),
      `export ${name}`,
    );
    const loaded = name === "alice" ? alice : name === "bob" ? bob : carol;
    assertEquals(exported.fingerprint, loaded.toFingerprint());
    assertEquals(exported.signingKey, loaded.summary.signingKey);
    assertEquals(exported.encryptionKey, loaded.summary.encryptionKey);
    const path = `${home}/${name}.public.json`;
    await Deno.writeTextFile(path, JSON.stringify(exported));
    assertCliOk(
      await runCli(home, ["import", path, "--name", name]),
      `import ${name}`,
    );
  }
  return { home, alice, bob, carol };
}

function assertCoreVerifies(
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

Deno.test("CLI payloads round-trip through core", async () => {
  const { home, alice, bob, carol } = await prepareHome("ebp-cli-core-");
  try {
    const messagePath = `${home}/message.txt`;
    await Deno.writeTextFile(messagePath, MESSAGE);
    const alicePublic = asExternal(alice.summary as unknown as JsonRecord);

    const attached = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "--password",
        PASSWORD,
        "sign",
        messagePath,
      ]),
      "cli sign",
    );
    assertCoreVerifies(alicePublic, attached);
    assertEquals(
      Identity.VerifySignature(
        alicePublic,
        MESSAGE,
        tamperSignature(String(attached.signature)),
        String(attached.salt ?? ""),
      ),
      false,
    );

    const unsalted = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "--password",
        PASSWORD,
        "sign",
        messagePath,
        "--no-salt",
      ]),
      "cli sign --no-salt",
    );
    assertEquals(unsalted.salt, "");
    assertCoreVerifies(alicePublic, unsalted);

    const detached = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "--password",
        PASSWORD,
        "sign",
        messagePath,
        "--detached",
      ]),
      "cli sign --detached",
    );
    assertCoreVerifies(alicePublic, detached);

    const carolSigned = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "carol",
        "--password",
        PASSWORD,
        "sign",
        messagePath,
        "--no-salt",
      ]),
      "cli sphincs sign",
    );
    assertCoreVerifies(asExternal(carol.summary as unknown as JsonRecord), carolSigned);

    const unsignedCipher = parseJsonStdout(
      await runCli(home, [
        "encrypt",
        messagePath,
        "--recipient",
        "bob",
      ]),
      "cli encrypt",
    );
    assertEquals(
      bob.encryptionKey.decrypt(String(unsignedCipher.ciphertext)),
      MESSAGE,
    );

    const signedCipher = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "--password",
        PASSWORD,
        "encrypt",
        messagePath,
        "--recipient",
        "bob",
        "--sign",
      ]),
      "cli encrypt --sign",
    );
    const decrypted = bob.decryptAndVerify(
      String(signedCipher.ciphertext),
      alicePublic,
    );
    assertEquals(decrypted.message, MESSAGE);
    assertEquals(decrypted.verified, true);

    const coreAttachedPath = `${home}/core-attached.json`;
    await Deno.writeTextFile(
      coreAttachedPath,
      JSON.stringify(coreSignedMessage(alice, "core-salt")),
    );
    const cliVerify = await runCli(home, [
      "verify",
      coreAttachedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliVerify, "cli verify core signature");
    assertEquals(cliVerify.stdout.trim(), MESSAGE);

    const coreDetachedPath = `${home}/core-detached.json`;
    await Deno.writeTextFile(
      coreDetachedPath,
      JSON.stringify(coreDetached(carol, "")),
    );
    assertCliOk(
      await runCli(home, [
        "verify",
        messagePath,
        "--signature",
        coreDetachedPath,
        "--sender",
        "carol",
      ]),
      "cli verify core sphincs detached",
    );

    const coreUnsignedPath = `${home}/core-unsigned.json`;
    await Deno.writeTextFile(
      coreUnsignedPath,
      JSON.stringify(buildEncryptedMessagePayload({
        recipientFingerprint: bob.toFingerprint(),
        ciphertext: Identity.EncryptFor(bob.summary, MESSAGE),
      })),
    );
    const cliDecrypt = await runCli(home, [
      "--identity",
      "bob",
      "--password",
      PASSWORD,
      "decrypt",
      coreUnsignedPath,
    ]);
    assertCliOk(cliDecrypt, "cli decrypt core unsigned");
    assertEquals(cliDecrypt.stdout.trim(), MESSAGE);

    const coreSignedPath = `${home}/core-signed-encrypt.json`;
    await Deno.writeTextFile(
      coreSignedPath,
      JSON.stringify(buildEncryptedSignedMessagePayload({
        recipientFingerprint: bob.toFingerprint(),
        senderFingerprint: alice.toFingerprint(),
        ciphertext: alice.signAndEncryptFor(MESSAGE, bob.summary),
      })),
    );
    const cliDecryptSigned = await runCli(home, [
      "--identity",
      "bob",
      "--password",
      PASSWORD,
      "decrypt",
      coreSignedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliDecryptSigned, "cli decrypt core signed");
    assertEquals(cliDecryptSigned.stdout.trim(), MESSAGE);
    assert(cliDecryptSigned.stderr.includes("Decrypted and verified"));
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("GUI payloads round-trip through core", async () => {
  await initSecurity({ persist: false, host: "127.0.0.1", port: 8787 });
  const { home, alice, bob, carol } = await prepareHome("ebp-gui-core-");
  try {
    const alicePublic = asExternal(alice.summary as unknown as JsonRecord);
    const guiExport = await guiPost("/api/v1/identity/export-public", {
      home,
      identity: "alice",
      password: PASSWORD,
      includeDetails: true,
    });
    assertEquals(guiExport.status, 200, JSON.stringify(guiExport.body));
    assertEquals(guiExport.body.fingerprint, alice.toFingerprint());
    assertEquals(guiExport.body.signingKey, alice.summary.signingKey);
    assertEquals(guiExport.body.encryptionKey, alice.summary.encryptionKey);

    const guiAttached = await guiPost("/api/v1/sign", {
      home,
      identity: "alice",
      password: PASSWORD,
      message: MESSAGE,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiAttached.status, 200, JSON.stringify(guiAttached.body));
    assertCoreVerifies(alicePublic, guiAttached.body);

    const guiUnsalted = await guiPost("/api/v1/sign", {
      home,
      identity: "alice",
      password: PASSWORD,
      message: MESSAGE,
      includeSalt: false,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiUnsalted.status, 200, JSON.stringify(guiUnsalted.body));
    assertEquals(guiUnsalted.body.salt, "");
    assertCoreVerifies(alicePublic, guiUnsalted.body);

    const guiDetached = await guiPost("/api/v1/sign", {
      home,
      identity: "carol",
      password: PASSWORD,
      message: MESSAGE,
      detached: true,
      includeSalt: false,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiDetached.status, 200, JSON.stringify(guiDetached.body));
    assertCoreVerifies(
      asExternal(carol.summary as unknown as JsonRecord),
      guiDetached.body,
    );

    const guiUnsigned = await guiPost("/api/v1/encrypt", {
      home,
      recipient: "bob",
      message: MESSAGE,
    });
    assertEquals(guiUnsigned.status, 200, JSON.stringify(guiUnsigned.body));
    assertEquals(
      bob.encryptionKey.decrypt(String(guiUnsigned.body.ciphertext)),
      MESSAGE,
    );

    const guiSigned = await guiPost("/api/v1/encrypt", {
      home,
      identity: "alice",
      password: PASSWORD,
      recipient: "bob",
      message: MESSAGE,
      sign: true,
    });
    assertEquals(guiSigned.status, 200, JSON.stringify(guiSigned.body));
    const guiDecrypted = bob.decryptAndVerify(
      String(guiSigned.body.ciphertext),
      alicePublic,
    );
    assertEquals(guiDecrypted.message, MESSAGE);
    assertEquals(guiDecrypted.verified, true);

    const coreAttached = coreSignedMessage(alice, "gui-core-salt");
    const guiVerify = await guiPost("/api/v1/verify", {
      home,
      payload: coreAttached,
      publicIdentity: alice.summary as unknown as JsonRecord,
    });
    assertEquals(guiVerify.status, 200, JSON.stringify(guiVerify.body));
    assertEquals(guiVerify.body.verified, true);

    const guiVerifySphincs = await guiPost("/api/v1/verify", {
      home,
      payload: coreDetached(carol, ""),
      message: MESSAGE,
      publicIdentity: carol.summary as unknown as JsonRecord,
    });
    assertEquals(
      guiVerifySphincs.status,
      200,
      JSON.stringify(guiVerifySphincs.body),
    );
    assertEquals(guiVerifySphincs.body.verified, true);

    const guiDecryptUnsigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "bob",
      password: PASSWORD,
      payload: buildEncryptedMessagePayload({
        recipientFingerprint: bob.toFingerprint(),
        ciphertext: Identity.EncryptFor(bob.summary, MESSAGE),
      }) as unknown as JsonRecord,
    });
    assertEquals(
      guiDecryptUnsigned.status,
      200,
      JSON.stringify(guiDecryptUnsigned.body),
    );
    assertEquals(guiDecryptUnsigned.body.message, MESSAGE);

    const guiDecryptSigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "bob",
      password: PASSWORD,
      sender: "alice",
      payload: buildEncryptedSignedMessagePayload({
        recipientFingerprint: bob.toFingerprint(),
        senderFingerprint: alice.toFingerprint(),
        ciphertext: alice.signAndEncryptFor(MESSAGE, bob.summary),
      }) as unknown as JsonRecord,
    });
    assertEquals(
      guiDecryptSigned.status,
      200,
      JSON.stringify(guiDecryptSigned.body),
    );
    assertEquals(guiDecryptSigned.body.message, MESSAGE);
    assertEquals(guiDecryptSigned.body.verified, true);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
