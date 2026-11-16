import type { ExternalIdentity } from "../../core/Identity.ts";
import { computeExternalFingerprint } from "../../core/Fingerprint.ts";
import { validateContact, validateContactName, mergeContactRefresh } from "../../common/Contacts.ts";
import { type CLIContext, ensurePrivateDir } from "../../cli/utils.ts";
import { readJsonOptional, withFileLock } from "../../cli/json-store.ts";
import { writePrivateFileAtomic } from "../../cli/atomic-file.ts";
import { HttpError, STATUS } from "./http.ts";
export { computeExternalFingerprint };

export function contactPath(ctx: CLIContext, name: string): string {
  try { return `${ctx.contactsDir}/${validateContactName(name)}.json`; }
  catch { throw new HttpError(STATUS.BadRequest, "Contact name must be a single safe file name"); }
}
async function readContact(path: string): Promise<ExternalIdentity | null> {
  try {
    if ((await Deno.lstat(path)).isSymlink) throw new Error("Contact symlinks are unsupported");
  } catch (error) { if (error instanceof Deno.errors.NotFound) return null; throw error; }
  const value = await readJsonOptional(path);
  return value === null ? null : validateContact(value);
}
export async function listContacts(ctx: CLIContext): Promise<Array<{name: string; contact: ExternalIdentity}>> {
  const contacts: Array<{name: string; contact: ExternalIdentity}> = [];
  try {
    for await (const entry of Deno.readDir(ctx.contactsDir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      try {
        const name = entry.name.slice(0, -5);
        const contact = await readContact(contactPath(ctx, name));
        if (contact) contacts.push({name, contact});
      } catch (error) { console.warn(`Skipping damaged contact ${JSON.stringify(entry.name)}`, String(error)); }
    }
  } catch (error) { if (!(error instanceof Deno.errors.NotFound)) throw error; }
  return contacts;
}
export async function findContactRecord(ctx: CLIContext, fingerprint: string): Promise<{name: string; path: string; contact: ExternalIdentity} | null> {
  const query = fingerprint.trim();
  if (!query) return null;
  const matches = (await listContacts(ctx)).filter(item => item.contact.fingerprint.startsWith(query));
  if (matches.length > 1) throw new HttpError(STATUS.Conflict, "ambiguous contact fingerprint");
  return matches[0] ? {...matches[0], path: contactPath(ctx, matches[0].name)} : null;
}
export async function loadContact(ctx: CLIContext, nameOrFingerprint: string): Promise<ExternalIdentity> {
  const path = contactPath(ctx, nameOrFingerprint);
  const direct = await readContact(path);
  if (direct) return direct;
  const found = await findContactRecord(ctx, nameOrFingerprint);
  if (!found) throw new HttpError(STATUS.NotFound, "contact not found");
  return found.contact;
}
export async function deleteContact(ctx: CLIContext, name?: string, fingerprint?: string): Promise<string> {
  if (!name && !fingerprint) throw new HttpError(STATUS.BadRequest, "name or fingerprint is required");
  const target = name ? {name, path: contactPath(ctx, name)} : await findContactRecord(ctx, fingerprint!);
  if (!target) throw new HttpError(STATUS.NotFound, "contact not found");
  await withFileLock(target.path, () => Deno.remove(target.path));
  return target.name;
}
export async function updateContactRecord(ctx: CLIContext, fingerprint: string, mutate: (contact: ExternalIdentity) => void): Promise<void> {
  const found = await findContactRecord(ctx, fingerprint);
  if (!found) throw new HttpError(STATUS.NotFound, "contact not found");
  await withFileLock(found.path, async () => {
    const current = await readContact(found.path);
    if (!current || current.fingerprint !== found.contact.fingerprint) throw new HttpError(STATUS.Conflict, "contact changed");
    mutate(current);
    await writePrivateFileAtomic(found.path, JSON.stringify(current, null, 2));
  });
}
export async function saveExternalContact(ctx: CLIContext, external: ExternalIdentity, name?: string): Promise<{name: string; fingerprint: string}> {
  let validated: ExternalIdentity;
  try { validated = validateContact(external); }
  catch { throw new HttpError(STATUS.BadRequest, "invalid identity keys or fingerprint"); }
  const contactName = name?.trim() || validated.fingerprint.substring(0, 16);
  const path = contactPath(ctx, contactName);
  await ensurePrivateDir(ctx.contactsDir);
  await withFileLock(path, async () => {
    const existing = await readContact(path);
    const merged = mergeContactRefresh(existing, validated);
    await writePrivateFileAtomic(path, JSON.stringify(merged, null, 2));
  });
  return {name: contactName, fingerprint: validated.fingerprint};
}
