import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert";

// The CLI signs and encrypts, then a second CLI process verifies and decrypts
// that output. Contacts are the CLI's own public exports, which verify and
// decrypt look up with --sender and --recipient.

const PASSWORD = "Cli-cli-test-pass1";
const MESSAGE = "CLI to CLI compatibility\nline two";
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
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

async function exportAndImport(home: string, name: string): Promise<void> {
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
}

async function sign(
  home: string,
  identity: string,
  messagePath: string,
  extra: string[] = [],
): Promise<JsonRecord> {
  return parseJsonStdout(
    await runCli(home, [
      "--identity",
      identity,
      "--password",
      PASSWORD,
      "sign",
      messagePath,
      ...extra,
    ]),
    `sign ${identity} ${extra.join(" ")}`.trim(),
  );
}

async function verifyOk(
  home: string,
  args: string[],
  label: string,
): Promise<void> {
  const result = await runCli(home, ["verify", ...args]);
  assertCliOk(result, label);
  assertEquals(result.stdout.trim(), MESSAGE);
  assert(result.stderr.includes("Signature verified"), result.stderr);
}

Deno.test("CLI verifies and decrypts its own payloads", async () => {
  const home = await Deno.makeTempDir({ prefix: "ebp-cli-cli-" });
  try {
    await generateIdentity(home, "alice", "dilithium");
    await generateIdentity(home, "bob", "dilithium");
    await generateIdentity(home, "carol", "sphincs");
    await exportAndImport(home, "alice");
    await exportAndImport(home, "bob");
    await exportAndImport(home, "carol");

    const messagePath = `${home}/message.txt`;
    await Deno.writeTextFile(messagePath, MESSAGE);

    const attached = await sign(home, "alice", messagePath);
    assertEquals(attached.type, "ebp-signed-message");
    const attachedPath = `${home}/attached.json`;
    await Deno.writeTextFile(attachedPath, JSON.stringify(attached));
    await verifyOk(home, [attachedPath, "--sender", "alice"], "verify attached");

    const tampered = {
      ...attached,
      signature: tamperSignature(String(attached.signature)),
    };
    const tamperedPath = `${home}/tampered.json`;
    await Deno.writeTextFile(tamperedPath, JSON.stringify(tampered));
    const verifyTampered = await runCli(home, [
      "verify",
      tamperedPath,
      "--sender",
      "alice",
    ]);
    assertNotEquals(verifyTampered.code, 0, verifyTampered.stderr);
    assert(
      verifyTampered.stderr.includes("Signature verification FAILED"),
      verifyTampered.stderr,
    );

    const unsalted = await sign(home, "alice", messagePath, ["--no-salt"]);
    assertEquals(unsalted.salt, "");
    const unsaltedPath = `${home}/unsalted.json`;
    await Deno.writeTextFile(unsaltedPath, JSON.stringify(unsalted));
    await verifyOk(home, [unsaltedPath, "--sender", "alice"], "verify unsalted");

    const detached = await sign(home, "alice", messagePath, ["--detached"]);
    assertEquals(detached.type, "ebp-signature");
    const detachedPath = `${home}/detached.json`;
    await Deno.writeTextFile(detachedPath, JSON.stringify(detached));
    await verifyOk(
      home,
      [messagePath, "--signature", detachedPath, "--sender", "alice"],
      "verify detached",
    );

    const sphincs = await sign(home, "carol", messagePath, ["--no-salt"]);
    const sphincsPath = `${home}/sphincs.json`;
    await Deno.writeTextFile(sphincsPath, JSON.stringify(sphincs));
    await verifyOk(home, [sphincsPath, "--sender", "carol"], "verify sphincs");

    const encrypted = parseJsonStdout(
      await runCli(home, [
        "--identity",
        "alice",
        "encrypt",
        messagePath,
        "--recipient",
        "bob",
      ]),
      "encrypt unsigned",
    );
    assertEquals(encrypted.type, "ebp-encrypted-message");
    const encryptedPath = `${home}/encrypted.json`;
    await Deno.writeTextFile(encryptedPath, JSON.stringify(encrypted));
    const decryptUnsigned = await runCli(home, [
      "--identity",
      "bob",
      "--password",
      PASSWORD,
      "decrypt",
      encryptedPath,
    ]);
    assertCliOk(decryptUnsigned, "decrypt unsigned");
    assertEquals(decryptUnsigned.stdout.trim(), MESSAGE);
    assert(
      decryptUnsigned.stderr.includes("Decrypted (unsigned - sender unknown)"),
      decryptUnsigned.stderr,
    );

    const signedEncrypt = parseJsonStdout(
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
      "encrypt signed",
    );
    assertEquals(signedEncrypt.type, "ebp-encrypted-signed-message");
    const signedPath = `${home}/signed-encrypt.json`;
    await Deno.writeTextFile(signedPath, JSON.stringify(signedEncrypt));
    const decryptSigned = await runCli(home, [
      "--identity",
      "bob",
      "--password",
      PASSWORD,
      "decrypt",
      signedPath,
      "--sender",
      "alice",
    ]);
    assertCliOk(decryptSigned, "decrypt signed");
    assertEquals(decryptSigned.stdout.trim(), MESSAGE);
    assert(
      decryptSigned.stderr.includes("Decrypted and verified"),
      decryptSigned.stderr,
    );
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
