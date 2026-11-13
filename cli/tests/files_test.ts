import { assertEquals, assertRejects } from "jsr:@std/assert";
import { Identity } from "../../core/Identity.ts";
import {
  buildEncryptedFilePayload,
  createFileCleartextEnvelope,
} from "../../core/FilePayload.ts";
import { cmdDecryptFile } from "../commands/files.ts";

Deno.test("decrypt-file refuses sender-selected collisions and symlinks", async () => {
  const dir = await Deno.makeTempDir();
  const cwd = Deno.cwd();
  try {
    const identity = new Identity("dilithium", "kyber");
    const password = "File-Output-Pass-42";
    const ctx = {
      identityDir: dir,
      identityPath: `${dir}/me.identity.json`,
      contactsDir: `${dir}/contacts`,
      currentIdentity: "me",
    };
    await Deno.writeTextFile(
      ctx.identityPath,
      identity.toStorageFormat(password),
    );
    const bytes = new TextEncoder().encode("received contents");
    const ciphertext = Identity.EncryptFor(
      identity.summary,
      JSON.stringify(createFileCleartextEnvelope(bytes, "package.json")),
    );
    const payload = buildEncryptedFilePayload({
      recipientFingerprint: identity.toFingerprint(),
      fileName: "package.json",
      mimeType: "application/octet-stream",
      fileSize: bytes.length,
      ciphertext,
    });
    await Deno.writeTextFile(`${dir}/payload.json`, JSON.stringify(payload));
    await Deno.writeTextFile(`${dir}/package.json`, "original");
    Deno.chdir(dir);
    const args = { _: ["payload.json"], password };
    await assertRejects(
      () => cmdDecryptFile(args, ctx),
      Deno.errors.AlreadyExists,
    );
    assertEquals(await Deno.readTextFile("package.json"), "original");
    if (Deno.build.os !== "windows") {
      await Deno.symlink(`${dir}/package.json`, `${dir}/link`);
      await assertRejects(
        () => cmdDecryptFile({ ...args, output: "link" }, ctx),
        Deno.errors.AlreadyExists,
      );
      assertEquals(await Deno.readTextFile("package.json"), "original");
    }
    await cmdDecryptFile({ ...args, output: "received.txt" }, ctx);
    assertEquals(await Deno.readFile("received.txt"), bytes);
  } finally {
    Deno.chdir(cwd);
    await Deno.remove(dir, { recursive: true });
  }
});
