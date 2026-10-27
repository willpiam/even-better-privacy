import { assert, assertEquals } from "jsr:@std/assert";
import { sha256Hex } from "../../core/MessageHash.ts";
import { handleRequest } from "../../gui/local-backend/routes.ts";
import { getCsrfToken, initSecurity } from "../../gui/local-backend/security.ts";

// Drives the CLI process and the GUI local-backend handler against one
// temporary home, so each side reads the identity files and payload JSON
// the other side wrote.

const PASSWORD = "Cli-gui-test-pass1";
const MESSAGE = "CLI GUI compatibility\nline two";
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

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

async function exportAndImport(
  home: string,
  identity: string,
  contactName: string,
): Promise<JsonRecord> {
  const exported = parseJsonStdout(
    await runCli(home, [
      "--identity",
      identity,
      "--password",
      PASSWORD,
      "export-public",
    ]),
    `cli export ${identity}`,
  );
  const guiExport = await guiPost("/api/v1/identity/export-public", {
    home,
    identity,
    password: PASSWORD,
    includeDetails: true,
  });
  assertEquals(
    guiExport.status,
    200,
    `gui export ${identity}: ${JSON.stringify(guiExport.body)}`,
  );
  assertEquals(guiExport.body.fingerprint, exported.fingerprint);
  assertEquals(guiExport.body.signingKey, exported.signingKey);
  assertEquals(guiExport.body.encryptionKey, exported.encryptionKey);

  const path = `${home}/${contactName}.public.json`;
  await Deno.writeTextFile(path, JSON.stringify(exported));
  assertCliOk(
    await runCli(home, ["import", path, "--name", contactName]),
    `import ${contactName}`,
  );

  const fingerprint = await guiPost("/api/v1/identity/fingerprint-from-public", {
    publicIdentity: exported,
  });
  assertEquals(fingerprint.status, 200, JSON.stringify(fingerprint.body));
  assertEquals(fingerprint.body.fingerprint, exported.fingerprint);
  return exported;
}

async function guiVerify(
  home: string,
  payload: JsonRecord,
  publicIdentity: JsonRecord,
  message?: string,
): Promise<boolean> {
  const res = await guiPost("/api/v1/verify", {
    home,
    payload,
    publicIdentity,
    ...(message === undefined ? {} : { message }),
  });
  assertEquals(res.status, 200, JSON.stringify(res.body));
  return res.body.verified === true;
}

Deno.test("CLI and GUI accept each other's payloads", async () => {
  await initSecurity({ persist: false, host: "127.0.0.1", port: 8787 });
  const home = await Deno.makeTempDir({ prefix: "ebp-cli-gui-" });
  try {
    await generateIdentity(home, "alice", "dilithium");
    await generateIdentity(home, "bob", "dilithium");
    await generateIdentity(home, "carol", "sphincs");

    const alice = await exportAndImport(home, "alice", "alice");
    const bob = await exportAndImport(home, "bob", "bob");
    const carol = await exportAndImport(home, "carol", "carol");
    assert(typeof bob.fingerprint === "string" && bob.fingerprint.length > 0);

    const messagePath = `${home}/message.txt`;
    await Deno.writeTextFile(messagePath, MESSAGE);

    const cliAttached = parseJsonStdout(
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
    assertEquals(cliAttached.type, "ebp-signed-message");
    assert(
      await guiVerify(home, cliAttached, alice),
      "GUI rejected a salted CLI signature",
    );
    assertEquals(
      await guiVerify(home, {
        ...cliAttached,
        signature: tamperSignature(String(cliAttached.signature)),
      }, alice),
      false,
      "GUI accepted a tampered CLI signature",
    );

    const cliUnsalted = parseJsonStdout(
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
    assert(
      await guiVerify(home, cliUnsalted, alice),
      "GUI rejected an unsalted CLI signature",
    );

    const cliDetached = parseJsonStdout(
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
    assert(
      await guiVerify(home, cliDetached, alice, MESSAGE),
      "GUI rejected a detached CLI signature",
    );

    const guiAttached = await guiPost("/api/v1/sign", {
      home,
      identity: "alice",
      password: PASSWORD,
      message: MESSAGE,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiAttached.status, 200, JSON.stringify(guiAttached.body));
    const guiAttachedPath = `${home}/gui-attached.json`;
    await Deno.writeTextFile(guiAttachedPath, JSON.stringify(guiAttached.body));
    const cliVerifyAttached = await runCli(home, [
      "verify",
      guiAttachedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliVerifyAttached, "cli verify gui attached");
    assertEquals(cliVerifyAttached.stdout.trim(), MESSAGE);

    const guiDetached = await guiPost("/api/v1/sign", {
      home,
      identity: "alice",
      password: PASSWORD,
      message: MESSAGE,
      detached: true,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiDetached.status, 200, JSON.stringify(guiDetached.body));
    const guiDetachedPath = `${home}/gui-detached.json`;
    await Deno.writeTextFile(guiDetachedPath, JSON.stringify(guiDetached.body));
    const cliVerifyDetached = await runCli(home, [
      "verify",
      messagePath,
      "--signature",
      guiDetachedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliVerifyDetached, "cli verify gui detached");
    assertEquals(cliVerifyDetached.stdout.trim(), MESSAGE);

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
    assert(
      await guiVerify(home, carolSigned, carol),
      "GUI rejected a CLI SPHINCS+ signature",
    );
    const guiSphincs = await guiPost("/api/v1/sign", {
      home,
      identity: "carol",
      password: PASSWORD,
      message: MESSAGE,
      includeSalt: false,
      signConfirmation: signConfirmation(MESSAGE),
    });
    assertEquals(guiSphincs.status, 200, JSON.stringify(guiSphincs.body));
    const guiSphincsPath = `${home}/gui-sphincs.json`;
    await Deno.writeTextFile(guiSphincsPath, JSON.stringify(guiSphincs.body));
    assertCliOk(
      await runCli(home, ["verify", guiSphincsPath, "--sender", "carol"]),
      "cli verify gui sphincs",
    );

    const cliEncrypted = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "encrypt",
        messagePath,
        "--recipient",
        "bob",
      ]),
      "cli encrypt",
    );
    const guiDecryptUnsigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "bob",
      password: PASSWORD,
      payload: cliEncrypted,
    });
    assertEquals(
      guiDecryptUnsigned.status,
      200,
      JSON.stringify(guiDecryptUnsigned.body),
    );
    assertEquals(guiDecryptUnsigned.body.message, MESSAGE);

    const guiEncrypted = await guiPost("/api/v1/encrypt", {
      home,
      identity: "bob",
      recipient: "alice",
      message: MESSAGE,
    });
    assertEquals(guiEncrypted.status, 200, JSON.stringify(guiEncrypted.body));
    const guiEncryptedPath = `${home}/gui-encrypted.json`;
    await Deno.writeTextFile(
      guiEncryptedPath,
      JSON.stringify(guiEncrypted.body),
    );
    const cliDecryptUnsigned = await runCli(home, [
      "--identity",
      "alice",
      "--password",
      PASSWORD,
      "decrypt",
      guiEncryptedPath,
    ]);
    assertCliOk(cliDecryptUnsigned, "cli decrypt gui unsigned");
    assertEquals(cliDecryptUnsigned.stdout.trim(), MESSAGE);

    const cliSignedEncrypt = parseJsonStdout(
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
    const guiDecryptSigned = await guiPost("/api/v1/decrypt", {
      home,
      identity: "bob",
      password: PASSWORD,
      sender: "alice",
      payload: cliSignedEncrypt,
    });
    assertEquals(
      guiDecryptSigned.status,
      200,
      JSON.stringify(guiDecryptSigned.body),
    );
    assertEquals(guiDecryptSigned.body.message, MESSAGE);
    assertEquals(guiDecryptSigned.body.verified, true);

    const guiSignedEncrypt = await guiPost("/api/v1/encrypt", {
      home,
      identity: "bob",
      password: PASSWORD,
      recipient: "alice",
      message: MESSAGE,
      sign: true,
    });
    assertEquals(
      guiSignedEncrypt.status,
      200,
      JSON.stringify(guiSignedEncrypt.body),
    );
    const guiSignedPath = `${home}/gui-signed-encrypt.json`;
    await Deno.writeTextFile(
      guiSignedPath,
      JSON.stringify(guiSignedEncrypt.body),
    );
    const cliDecryptSigned = await runCli(home, [
      "--identity",
      "alice",
      "--password",
      PASSWORD,
      "decrypt",
      guiSignedPath,
      "--sender",
      "bob",
    ]);
    assertCliOk(cliDecryptSigned, "cli decrypt gui signed");
    assertEquals(cliDecryptSigned.stdout.trim(), MESSAGE);
    assert(
      cliDecryptSigned.stderr.includes("Decrypted and verified"),
      cliDecryptSigned.stderr,
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
