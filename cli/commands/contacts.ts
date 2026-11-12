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

  await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2), {
    mode: 0o600,
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
        const contactPath = `${ctx.contactsDir}/${entry.name}`;
        const json = await Deno.readTextFile(contactPath);
        const contact = validateContact(parseStrictJson(json));
        const name = entry.name.replace(".json", "");
        console.log(`  ${name}`);
        console.log(`    Fingerprint: ${contact.fingerprint}`);
        console.log(
          `    Signing: ${contact.signingKeyType}, Encryption: ${contact.encryptionKeyType}`,
        );
        count++;
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

/** Contact aliases cannot introduce path separators or control characters. */
export function validateContactName(name: string): string {
  if (
    typeof name !== "string" || !name.trim() || name === "." || name === ".." ||
    /[/\\:\x00-\x1f\x7f]/.test(name)
  ) {
    throw new Error("Contact name must be a single safe file name");
  }
  return name;
}

/** Validate the stored claim against the actual public keys before trusting it. */
export function validateContact(value: unknown): ExternalIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid contact identity");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.fingerprint !== "string" || !record.fingerprint) {
    throw new Error("Invalid contact fingerprint");
  }
  const validated = externalIdentityFromEmbeddedRecord(
    record,
    record.fingerprint,
  );
  if (!validated) {
    throw new Error("Invalid contact keys or fingerprint mismatch");
  }
  return { ...record, ...validated };
}

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
      const value = parseStrictJson(
        await Deno.readTextFile(`${ctx.contactsDir}/${entry.name}`),
      );
      if (
        typeof value?.fingerprint === "string" &&
        value.fingerprint.startsWith(nameOrFingerprint)
      ) {
        return validateContact(value);
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  throw new Error(`Contact not found: ${nameOrFingerprint}`);
}
