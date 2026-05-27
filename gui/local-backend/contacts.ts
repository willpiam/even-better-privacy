import type { ExternalIdentity } from "../../core/Identity.ts";
import { computeIdentityFingerprint } from "../../core/Fingerprint.ts";
import type { CLIContext } from "../../cli/utils.ts";
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

export function computeExternalFingerprint(
  identity:
    & Pick<ExternalIdentity, "signingKeyType" | "encryptionKeyType">
    & Partial<
      Pick<
        ExternalIdentity,
        "signingKey" | "signingKeyHash" | "encryptionKey" | "encryptionKeyHash"
      >
    >,
): string | null {
  try {
    return computeIdentityFingerprint({
      signingKeyType: identity.signingKeyType,
      encryptionKeyType: identity.encryptionKeyType,
      signingKey: identity.signingKey,
      signingKeyHash: identity.signingKeyHash,
      encryptionKey: identity.encryptionKey,
      encryptionKeyHash: identity.encryptionKeyHash,
    });
  } catch {
    return null;
  }
}
