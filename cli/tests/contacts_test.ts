import { assertEquals, assertRejects } from "jsr:@std/assert@^1.0.6";
import { Identity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { cmdImportContact, loadContact } from "../commands/contacts.ts";
import { cmdVerify } from "../commands/crypto.ts";
import type { CLIContext } from "../utils.ts";

const alice = new Identity("dilithium", "kyber");
const bob = new Identity("dilithium", "kyber");

async function withContacts(
  run: (ctx: CLIContext, input: string) => Promise<void>,
) {
  const root = await Deno.makeTempDir();
  try {
    const ctx = {
      identityDir: root,
      contactsDir: `${root}/contacts`,
      currentIdentity: "a",
      identityPath: `${root}/a.identity.json`,
    };
    await Deno.mkdir(ctx.contactsDir);
    await run(ctx, `${root}/input.json`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test("contact import cannot escape the contacts directory through names or fingerprints", async () => {
  await withContacts(async (ctx, input) => {
    await Deno.writeTextFile(ctx.identityPath, "private identity sentinel");
    await Deno.writeTextFile(input, JSON.stringify(alice.summary));
    for (
      const name of [
        "../a.identity",
        "..\\a.identity",
        "/absolute",
        "C:escape",
        "bad\nname",
        "",
      ]
    ) {
      await assertRejects(
        () => cmdImportContact({ _: [input], name }, ctx),
        Error,
        "safe file name",
      );
    }
    await Deno.writeTextFile(
      input,
      JSON.stringify({ ...alice.summary, fingerprint: "../a.identity" }),
    );
    await assertRejects(
      () => cmdImportContact({ _: [input] }, ctx),
      Error,
      "fingerprint mismatch",
    );
    assertEquals(
      await Deno.readTextFile(ctx.identityPath),
      "private identity sentinel",
    );
    assertEquals([...Deno.readDirSync(ctx.contactsDir)], []);
    await assertRejects(
      () => loadContact(ctx, "../a.identity"),
      Error,
      "safe file name",
    );
  });
});

Deno.test("import and stored contact loads reject keys bound to another fingerprint", async () => {
  await withContacts(async (ctx, input) => {
    const forged = { ...bob.summary, fingerprint: alice.toFingerprint() };
    await Deno.writeTextFile(input, JSON.stringify(forged));
    await assertRejects(
      () => cmdImportContact({ _: [input], name: "Alice" }, ctx),
      Error,
      "fingerprint mismatch",
    );
    await Deno.writeTextFile(
      `${ctx.contactsDir}/Alice.json`,
      JSON.stringify(forged),
    );
    await assertRejects(
      () => loadContact(ctx, "Alice"),
      Error,
      "fingerprint mismatch",
    );
    await assertRejects(
      () => loadContact(ctx, alice.toFingerprint().slice(0, 16)),
      Error,
      "fingerprint mismatch",
    );
  });
});

Deno.test("valid contacts retain aliases and verify legitimate signatures but reject mismatched payload claims", async () => {
  await withContacts(async (ctx, input) => {
    await Deno.writeTextFile(input, JSON.stringify(alice.summary));
    await cmdImportContact({ _: [input], name: "Alice Smith" }, ctx);
    assertEquals(
      (await loadContact(ctx, "Alice Smith")).fingerprint,
      alice.toFingerprint(),
    );
    assertEquals(
      (await loadContact(ctx, alice.toFingerprint().slice(0, 16))).fingerprint,
      alice.toFingerprint(),
    );
    const message = "contact regression";
    const signed = {
      type: "ebp-signed-message",
      message,
      messageHash: sha256Hex(message),
      signature: alice.signMessage(message),
      fingerprint: alice.toFingerprint(),
    };
    await Deno.writeTextFile(input, JSON.stringify(signed));
    await cmdVerify({ _: [input], sender: "Alice Smith" }, ctx);
    await Deno.writeTextFile(
      input,
      JSON.stringify({ ...signed, fingerprint: bob.toFingerprint() }),
    );
    await assertRejects(
      () => cmdVerify({ _: [input], sender: "Alice Smith" }, ctx),
      Error,
      "Fingerprint mismatch",
    );
  });
});
