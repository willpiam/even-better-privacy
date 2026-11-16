import type { ExternalIdentity } from "../core/ExternalIdentity.ts";
import { externalIdentityFromEmbeddedRecord } from "../core/EmbeddedIdentity.ts";
import { sha256Hex } from "../core/MessageHash.ts";

/** Aliases are data, and may identify only one file in the contact directory. */
export function validateContactName(name: string): string {
  if (
    typeof name !== "string" || !name.trim() || name === "." || name === ".." ||
    /[/\\:\x00-\x1f\x7f]/.test(name)
  ) {
    throw new Error("Contact name must be a single safe file name");
  }
  return name;
}

export function validateContact(value: unknown): ExternalIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid contact identity");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.fingerprint !== "string" || !record.fingerprint) {
    throw new Error("Invalid contact fingerprint");
  }
  const valid = externalIdentityFromEmbeddedRecord(record, record.fingerprint);
  if (!valid) throw new Error("Invalid contact keys or fingerprint mismatch");
  return { ...record, ...valid };
}

/** Cached cleartext is usable only while it proves the current, active claim. */
export function validOpaqueResolutions(
  contact: Pick<
    ExternalIdentity,
    "details" | "resolvedOpaqueDetails" | "revoked" | "revokedDetails"
  >,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (contact.revoked) return result;
  for (
    const [path, value] of Object.entries(contact.resolvedOpaqueDetails ?? {})
  ) {
    const claim = contact.details?.[path];
    const hash = Array.isArray(claim) ? claim[0] : claim;
    if (
      path.startsWith("opaque::") && !contact.revokedDetails?.includes(path) &&
      typeof value === "string" && sha256Hex(value) === hash
    ) result[path] = value;
  }
  return result;
}

/** Remote attestations replace remote state; local notes survive same-identity refresh. */
export function mergeContactRefresh(
  existing: ExternalIdentity | null,
  incoming: ExternalIdentity,
): ExternalIdentity {
  const next = { ...validateContact(incoming) } as
    & ExternalIdentity
    & Record<string, unknown>;
  const same = existing?.fingerprint === next.fingerprint;
  next.resolvedOpaqueDetails = validOpaqueResolutions({
    ...next,
    resolvedOpaqueDetails: {
      ...next.resolvedOpaqueDetails,
      ...(same ? existing?.resolvedOpaqueDetails : {}),
    },
  });
  if (same) {
    for (const key of ["localAlias", "localDescription", "localEmail"]) {
      const value =
        (existing as ExternalIdentity & Record<string, unknown>)[key];
      if (typeof value === "string") next[key] = value;
    }
  }
  return next;
}
