import { assert, assertEquals } from "jsr:@std/assert";
import type { ExternalIdentity } from "../../core/ExternalIdentity.ts";
import { Identity } from "../../core/Identity.ts";
import {
  decryptMessageWithIdentity,
  encryptMessageWithIdentity,
} from "../../mobile/src/services/encryptDecryptLogic.ts";
import {
  signMessageWithIdentity,
  verifyMessagePayload,
} from "../../mobile/src/services/signVerifyLogic.ts";

// The CLI runs as its own process. Mobile sign, verify, encrypt, and decrypt
// go through the helpers the app screens call. Identities are created by the
// CLI, then loaded with Identity.fromStorageFormat so the mobile helpers can
// use the same keys. This is not a device run.

const PASSWORD = "Cli-mobile-test1";
const MESSAGE = "CLI mobile compatibility\nline two";
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

function asExternal(value: JsonRecord): ExternalIdentity {
  return value as unknown as ExternalIdentity;
}

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

async function loadStored(home: string, name: string): Promise<Identity> {
  const raw = await Deno.readTextFile(`${home}/.ebp/${name}.identity.json`);
  return Identity.fromStorageFormat(raw, PASSWORD);
}

async function exportAndImport(
  home: string,
  name: string,
): Promise<JsonRecord> {
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
  const path = `${home}/${name}.public.json`;
  await Deno.writeTextFile(path, JSON.stringify(exported));
  assertCliOk(
    await runCli(home, ["import", path, "--name", name]),
    `import ${name}`,
  );
  return exported;
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

Deno.test("CLI and mobile accept each other's payloads", async () => {
  const home = await Deno.makeTempDir({ prefix: "ebp-cli-mobile-" });
  try {
    await generateIdentity(home, "alice", "dilithium");
    await generateIdentity(home, "bob", "dilithium");
    await generateIdentity(home, "carol", "sphincs");

    const alice = await loadStored(home, "alice");
    const bob = await loadStored(home, "bob");
    const carol = await loadStored(home, "carol");
    const alicePublic = asExternal(await exportAndImport(home, "alice"));
    const bobPublic = asExternal(await exportAndImport(home, "bob"));
    const carolPublic = asExternal(await exportAndImport(home, "carol"));
    assertEquals(alicePublic.fingerprint, alice.toFingerprint());
    assertEquals(alicePublic.signingKey, alice.summary.signingKey);
    assertEquals(bobPublic.encryptionKey, bob.summary.encryptionKey);
    assertEquals(carolPublic.fingerprint, carol.toFingerprint());

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
      mobileVerify(cliAttached, alicePublic),
      "mobile rejected a salted CLI signature",
    );
    assertEquals(
      mobileVerify({
        ...cliAttached,
        signature: tamperSignature(String(cliAttached.signature)),
      }, alicePublic),
      false,
      "mobile accepted a tampered CLI signature",
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
      mobileVerify(cliUnsalted, alicePublic),
      "mobile rejected an unsalted CLI signature",
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
      mobileVerify(cliDetached, alicePublic, MESSAGE),
      "mobile rejected a detached CLI signature",
    );

    const cliSphincs = parseJsonStdout(
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
      mobileVerify(cliSphincs, carolPublic),
      "mobile rejected a CLI SPHINCS+ signature",
    );

    const mobileAttached = signMessageWithIdentity(alice, MESSAGE, {
      includeIdentity: true,
    });
    assertEquals(mobileAttached.type, "ebp-signed-message");
    assertEquals(mobileAttached.fingerprint, alice.toFingerprint());
    const mobileAttachedPath = `${home}/mobile-attached.json`;
    await Deno.writeTextFile(mobileAttachedPath, JSON.stringify(mobileAttached));
    const cliVerifyAttached = await runCli(home, [
      "verify",
      mobileAttachedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliVerifyAttached, "cli verify mobile attached");
    assertEquals(cliVerifyAttached.stdout.trim(), MESSAGE);

    const mobileUnsalted = signMessageWithIdentity(alice, MESSAGE, {
      includeSalt: false,
    });
    assertEquals(mobileUnsalted.salt, "");
    const mobileUnsaltedPath = `${home}/mobile-unsalted.json`;
    await Deno.writeTextFile(mobileUnsaltedPath, JSON.stringify(mobileUnsalted));
    assertCliOk(
      await runCli(home, ["verify", mobileUnsaltedPath, "--sender", "alice"]),
      "cli verify mobile unsalted",
    );

    const mobileDetached = signMessageWithIdentity(alice, MESSAGE, {
      detached: true,
      includeIdentity: true,
    });
    assertEquals(mobileDetached.type, "ebp-signature");
    const mobileDetachedPath = `${home}/mobile-detached.json`;
    await Deno.writeTextFile(mobileDetachedPath, JSON.stringify(mobileDetached));
    const cliVerifyDetached = await runCli(home, [
      "verify",
      messagePath,
      "--signature",
      mobileDetachedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(cliVerifyDetached, "cli verify mobile detached");
    assertEquals(cliVerifyDetached.stdout.trim(), MESSAGE);

    const mobileSphincs = signMessageWithIdentity(carol, MESSAGE, {
      includeSalt: false,
    });
    const mobileSphincsPath = `${home}/mobile-sphincs.json`;
    await Deno.writeTextFile(mobileSphincsPath, JSON.stringify(mobileSphincs));
    assertCliOk(
      await runCli(home, ["verify", mobileSphincsPath, "--sender", "carol"]),
      "cli verify mobile sphincs",
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
    const mobileDecryptUnsigned = decryptMessageWithIdentity({
      identity: bob,
      payload: cliEncrypted,
    });
    assertEquals(mobileDecryptUnsigned.message, MESSAGE);
    assertEquals(mobileDecryptUnsigned.verifyStatus, "unsigned");

    const mobileEncrypted = encryptMessageWithIdentity({
      message: MESSAGE,
      recipient: alicePublic,
    });
    assertEquals(mobileEncrypted.type, "ebp-encrypted-message");
    const mobileEncryptedPath = `${home}/mobile-encrypted.json`;
    await Deno.writeTextFile(
      mobileEncryptedPath,
      JSON.stringify(mobileEncrypted),
    );
    const cliDecryptUnsigned = await runCli(home, [
      "--identity",
      "alice",
      "--password",
      PASSWORD,
      "decrypt",
      mobileEncryptedPath,
    ]);
    assertCliOk(cliDecryptUnsigned, "cli decrypt mobile unsigned");
    assertEquals(cliDecryptUnsigned.stdout.trim(), MESSAGE);
    assert(
      cliDecryptUnsigned.stderr.includes("Decrypted (unsigned - sender unknown)"),
      cliDecryptUnsigned.stderr,
    );

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
    const mobileDecryptSigned = decryptMessageWithIdentity({
      identity: bob,
      payload: cliSignedEncrypt,
      sender: alicePublic,
    });
    assertEquals(mobileDecryptSigned.message, MESSAGE);
    assertEquals(mobileDecryptSigned.verified, true);

    const mobileSignedEncrypt = encryptMessageWithIdentity({
      message: MESSAGE,
      recipient: alicePublic,
      identity: bob,
      sign: true,
    });
    assertEquals(mobileSignedEncrypt.type, "ebp-encrypted-signed-message");
    const mobileSignedPath = `${home}/mobile-signed-encrypt.json`;
    await Deno.writeTextFile(
      mobileSignedPath,
      JSON.stringify(mobileSignedEncrypt),
    );
    const cliDecryptSigned = await runCli(home, [
      "--identity",
      "alice",
      "--password",
      PASSWORD,
      "decrypt",
      mobileSignedPath,
      "--sender",
      "bob",
    ]);
    assertCliOk(cliDecryptSigned, "cli decrypt mobile signed");
    assertEquals(cliDecryptSigned.stdout.trim(), MESSAGE);
    assert(
      cliDecryptSigned.stderr.includes("Decrypted and verified"),
      cliDecryptSigned.stderr,
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
