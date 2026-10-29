import type { ExternalIdentity } from "../../core/Identity.ts";
import { computeExternalFingerprint } from "../../core/Fingerprint.ts";

export { computeExternalFingerprint };
import { type CLIContext, ensurePrivateDir } from "../../cli/utils.ts";
import { HttpError, STATUS } from "./http.ts";

export async function loadContact(
  ctx: CLIContext,
  nameOrFingerprint: string,
): Promise<ExternalIdentity> {
  const byName = `${ctx.contactsDir}/${nameOrFingerprint}.json`;
  try {
    const json = await Deno.readTextFile(byName);
    return JSON.parse(json) as ExternalIdentity;
  } catch {
    // Try fingerprint prefix search
    try {
      for await (const entry of Deno.readDir(ctx.contactsDir)) {
        if (entry.isFile && entry.name.endsWith(".json")) {
          const contactPath = `${ctx.contactsDir}/${entry.name}`;
          const json = await Deno.readTextFile(contactPath);
          const contact = JSON.parse(json) as ExternalIdentity;
          if (contact.fingerprint.startsWith(nameOrFingerprint)) {
            return contact;
          }
        }
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new HttpError(STATUS.NotFound, "no contacts found");
      }
      throw e;
    }
  }

  throw new HttpError(STATUS.NotFound, "contact not found");
}

export async function listContacts(
  ctx: CLIContext,
): Promise<Array<{ name: string; contact: ExternalIdentity }>> {
  const contacts: Array<{ name: string; contact: ExternalIdentity }> = [];
  try {
    for await (const entry of Deno.readDir(ctx.contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const name = entry.name.replace(".json", "");
      const json = await Deno.readTextFile(`${ctx.contactsDir}/${entry.name}`);
      contacts.push({ name, contact: JSON.parse(json) as ExternalIdentity });
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return contacts;
    throw e;
  }
  return contacts;
}

export async function findContactRecord(
  ctx: CLIContext,
  fingerprint: string,
): Promise<{ name: string; path: string; contact: ExternalIdentity } | null> {
  const query = fingerprint.trim();
  if (!query) return null;
  try {
    for await (const entry of Deno.readDir(ctx.contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const name = entry.name.replace(".json", "");
      const contactPath = `${ctx.contactsDir}/${entry.name}`;
      const json = await Deno.readTextFile(contactPath);
      const contact = JSON.parse(json) as ExternalIdentity;
      if (
        typeof contact.fingerprint === "string" &&
        (contact.fingerprint === query || contact.fingerprint.startsWith(query))
      ) {
        return { name, path: contactPath, contact };
      }
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  return null;
}

export async function deleteContact(
  ctx: CLIContext,
  name?: string,
  fingerprint?: string,
): Promise<string> {
  const byName = typeof name === "string" ? name.trim() : "";
  const byFingerprint = typeof fingerprint === "string"
    ? fingerprint.trim()
    : "";

  if (!byName && !byFingerprint) {
    throw new HttpError(STATUS.BadRequest, "name or fingerprint is required");
  }

  if (byName) {
    const contactPath = `${ctx.contactsDir}/${byName}.json`;
    try {
      await Deno.remove(contactPath);
      return byName;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }

  if (!byFingerprint) {
    throw new HttpError(STATUS.NotFound, "contact not found");
  }

  try {
    for await (const entry of Deno.readDir(ctx.contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const contactName = entry.name.replace(".json", "");
      const contactPath = `${ctx.contactsDir}/${entry.name}`;
      const json = await Deno.readTextFile(contactPath);
      const contact = JSON.parse(json) as ExternalIdentity;
      if (
        typeof contact.fingerprint === "string" &&
        (contact.fingerprint === byFingerprint ||
          contact.fingerprint.startsWith(byFingerprint))
      ) {
        await Deno.remove(contactPath);
        return contactName;
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }

  throw new HttpError(STATUS.NotFound, "contact not found");
}

export async function saveExternalContact(
  ctx: CLIContext,
  external: ExternalIdentity,
  name?: string,
): Promise<{ name: string; fingerprint: string }> {
  if (!external.fingerprint || !external.signingKey || !external.encryptionKey) {
    throw new HttpError(STATUS.BadGateway, "invalid identity payload from server");
  }
  await ensurePrivateDir(ctx.contactsDir);
  const contactName = name?.trim() || external.fingerprint.substring(0, 16);
  const contactPath = `${ctx.contactsDir}/${contactName}.json`;
  try {
    const existingRaw = await Deno.readTextFile(contactPath);
    const existing = JSON.parse(existingRaw) as ExternalIdentity & Record<string, unknown>;
    const preservedEntries = Object.entries(existing.resolvedOpaqueDetails ?? {})
      .filter((entry): entry is [string, string] =>
        typeof entry[1] === "string" && external.details[entry[0]] !== undefined
      );
    if (preservedEntries.length > 0) {
      external.resolvedOpaqueDetails = Object.fromEntries(preservedEntries);
    }
    for (const key of ["localAlias", "localDescription", "localEmail"] as const) {
      if (typeof existing[key] === "string" && existing[key]) {
        (external as Record<string, unknown>)[key] = existing[key];
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.warn("failed to preserve local data during fetch sync", e);
    }
  }
  await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2), {
    mode: 0o600,
  });
  return { name: contactName, fingerprint: external.fingerprint };
}

