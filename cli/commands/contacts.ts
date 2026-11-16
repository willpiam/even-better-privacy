import { validateContact, validateContactName, mergeContactRefresh } from "../../common/Contacts.ts";
import { readJsonOptional, withFileLock } from "../json-store.ts";
import { writePrivateFileAtomic } from "../atomic-file.ts";
import { parseArgs } from "@std/cli/parse-args";
import type { ExternalIdentity } from "../../core/Identity.ts";
import { externalIdentityFromEmbeddedRecord } from "../../core/EmbeddedIdentity.ts";
import { parseStrictJson } from "../../core/StrictJson.ts";
import { type CLIContext, ensurePrivateDir, readStdin } from "../utils.ts";

export async function cmdImportContact(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const inputFile = args._[0] as string | undefined;
  const name = args["name"] as string | undefined;

  let json: string;
  if (inputFile) {
    json = await Deno.readTextFile(inputFile);
  } else {
    json = await readStdin();
  }

  const external = validateContact(parseStrictJson(json));
  const contactName = validateContactName(
    name ?? external.fingerprint.substring(0, 16),
  );
  await ensurePrivateDir(ctx.contactsDir);
  const contactPath = `${ctx.contactsDir}/${contactName}.json`;

  await withFileLock(contactPath, async () => {
    const existing = await readJsonOptional<ExternalIdentity>(contactPath);
    await writePrivateFileAtomic(contactPath, JSON.stringify(mergeContactRefresh(existing, external), null, 2));
  });
  console.log(`✓ Contact imported: ${contactName}`);
  console.log(`  Fingerprint: ${external.fingerprint}`);
}

export async function cmdListContacts(
  _args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  try {
    const entries = Deno.readDir(ctx.contactsDir);
    let count = 0;

    console.log("Contacts:");
    for await (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".json")) {
        try {
        const contactPath = `${ctx.contactsDir}/${validateContactName(entry.name)}`;
        const json = await Deno.readTextFile(contactPath);
        const contact = validateContact(parseStrictJson(json));
        const name = entry.name.replace(".json", "");
        console.log(`  ${name}`);
        console.log(`    Fingerprint: ${contact.fingerprint}`);
        console.log(
          `    Signing: ${contact.signingKeyType}, Encryption: ${contact.encryptionKeyType}`,
        );
        count++;
        } catch (error) { console.warn(`Skipping damaged contact ${JSON.stringify(entry.name)}`, String(error)); }
      }
    }

    if (count === 0) {
      console.log("  (no contacts)");
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      console.log("Contacts:");
      console.log("  (no contacts)");
    } else {
      throw e;
    }
  }
}

export { validateContact, validateContactName } from "../../common/Contacts.ts";

export async function loadContact(
  ctx: CLIContext,
  nameOrFingerprint: string,
): Promise<ExternalIdentity> {
  validateContactName(nameOrFingerprint);
  const byName = `${ctx.contactsDir}/${nameOrFingerprint}.json`;
  try {
    return validateContact(parseStrictJson(await Deno.readTextFile(byName)));
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  try {
    for await (const entry of Deno.readDir(ctx.contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
      const value = parseStrictJson(
        await Deno.readTextFile(`${ctx.contactsDir}/${entry.name}`),
      );
      if (
        typeof value?.fingerprint === "string" &&
        value.fingerprint.startsWith(nameOrFingerprint)
      ) {
        return validateContact(value);
      }
      } catch (error) { console.warn(`Skipping damaged contact ${JSON.stringify(entry.name)}`, String(error)); }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  throw new Error(`Contact not found: ${nameOrFingerprint}`);
}
