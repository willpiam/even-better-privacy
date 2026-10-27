import { assert, assertEquals } from "jsr:@std/assert";
import {
  computeIdentityFingerprint,
  verifySignature,
} from "../../website/crypto.js";

// CLI signs with core/. The website verifier reimplements that check in
// website/crypto.js (the module verify.js calls). verify.js itself needs a
// browser DOM, so this test drives the CLI process and then calls the same
// verifySignature / fingerprint arguments the page passes.

const PASSWORD = "Cli-website-test1";
const MESSAGE = "CLI to website compatibility\nline two";
const CLI = new URL("../main.ts", import.meta.url).pathname;

type CliResult = { code: number; stdout: string; stderr: string };

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
  // Key generation prints its prompt only after the key exists. Write the
  // first password immediately; write the confirmation only after that
  // prompt, or one non-TTY read() swallows both lines.
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
    `generate failed\nstdout:\n${stdout.text}\nstderr:\n${stderr.text}`,
  );
}

function parseJsonStdout(result: CliResult, label: string): Record<string, unknown> {
  assertEquals(
    result.code,
    0,
    `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

function tamperSignature(signature: string): string {
  const chars = signature.split("");
  const index = chars.findIndex((char) => /[A-Za-z0-9+/]/.test(char));
  assert(index >= 0, "signature had no base64 payload");
  chars[index] = chars[index] === "A" ? "B" : "A";
  return chars.join("");
}

function websiteVerify(
  publicIdentity: Record<string, unknown>,
  payload: Record<string, unknown>,
  message: string,
): boolean {
  // Same argument shape as website/verify.js: message and messageHash together.
  // verifySignature prefers messageHash when it is present.
  return verifySignature(publicIdentity, {
    message,
    messageHash: payload.messageHash,
    salt: payload.salt ?? "",
    signature: payload.signature,
  });
}

Deno.test("CLI signatures verify in the website verifier", async (t) => {
  for (const signing of ["dilithium", "sphincs"] as const) {
    await t.step(`${signing}: attached, unsalted, and detached`, async () => {
      const home = await Deno.makeTempDir({ prefix: `ebp-cli-web-${signing}-` });
      try {
        await generateIdentity(home, "signer", signing);
        const messagePath = `${home}/message.txt`;
        await Deno.writeTextFile(messagePath, MESSAGE);

        const publicIdentity = parseJsonStdout(
          await runCli(home, ["--password", PASSWORD, "export-public"]),
          "export-public",
        );

        const attached = parseJsonStdout(
          await runCli(home, ["--password", PASSWORD, "sign", messagePath]),
          "sign",
        );
        assertEquals(attached.type, "ebp-signed-message");
        assertEquals(attached.fingerprint, publicIdentity.fingerprint);
        assertEquals(attached.message, MESSAGE);
        assert(
          websiteVerify(publicIdentity, attached, MESSAGE),
          "website rejected a salted CLI signed message",
        );
        assert(
          verifySignature(publicIdentity, {
            message: MESSAGE,
            salt: attached.salt,
            signature: attached.signature,
          }),
          "website rejected a salted CLI message when recomputing the hash",
        );

        const unsalted = parseJsonStdout(
          await runCli(home, [
            "--password",
            PASSWORD,
            "sign",
            messagePath,
            "--no-salt",
          ]),
          "sign --no-salt",
        );
        assertEquals(unsalted.salt, "");
        assert(
          websiteVerify(publicIdentity, unsalted, MESSAGE),
          "website rejected an unsalted CLI signed message",
        );

        const detached = parseJsonStdout(
          await runCli(home, [
            "--password",
            PASSWORD,
            "sign",
            messagePath,
            "--detached",
          ]),
          "sign --detached",
        );
        assertEquals(detached.type, "ebp-signature");
        assert(
          websiteVerify(publicIdentity, detached, MESSAGE),
          "website rejected a detached CLI signature",
        );

        const tampered = {
          ...attached,
          signature: tamperSignature(String(attached.signature)),
        };
        assertEquals(
          websiteVerify(publicIdentity, tampered, MESSAGE),
          false,
          "website accepted a tampered CLI signature",
        );

        // verify.js rejects the identity before crypto verify when this
        // disagrees with the fingerprint stored on the CLI export.
        const computed = computeIdentityFingerprint(publicIdentity);
        assertEquals(computed, publicIdentity.fingerprint);
      } finally {
        await Deno.remove(home, { recursive: true });
      }
    });
  }
});
