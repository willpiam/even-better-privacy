import { type ExternalIdentity } from "../../core/Identity.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { ensurePrivateDir, getContext } from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { deleteContact, findContactRecord, listContacts, saveExternalContact, updateContactRecord } from "./contacts.ts";

export async function handleContactsRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/v1/contacts") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const contacts = await listContacts(ctx);
    return json({
      contacts: contacts.map(({ name, contact }) => ({
        name,
        fingerprint: contact.fingerprint,
        signingKeyType: contact.signingKeyType,
        encryptionKeyType: contact.encryptionKeyType,
        details: contact.details ?? {},
        detailsMeta: contact.detailsMeta ?? {},
        resolvedOpaqueDetails: contact.resolvedOpaqueDetails ?? {},
        localAlias: (contact as Record<string, unknown>).localAlias as
          | string
          | undefined,
        localDescription: (contact as Record<string, unknown>)
          .localDescription as string | undefined,
        localEmail: (contact as Record<string, unknown>).localEmail as
          | string
          | undefined,
      })),
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/contacts/import") {
    const body = await readJson<
      { contact?: unknown; name?: unknown; home?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const contact = body.contact as ExternalIdentity | undefined;
    const name = typeof body.name === "string" ? body.name : undefined;
    if (!contact) {
      throw new HttpError(STATUS.BadRequest, "contact payload is required");
    }
    if (
      !contact.fingerprint || !contact.signingKey || !contact.encryptionKey
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "contact missing required fields",
      );
    }
    if (!isValidFingerprintBech32(contact.fingerprint)) {
      throw new HttpError(
        STATUS.BadRequest,
        "contact fingerprint must be valid bech32",
      );
    }

    const ctx = await getContext(home);
    const {name: contactName} = await saveExternalContact(ctx, contact, name);

    return json({
      ok: true,
      name: contactName,
      fingerprint: contact.fingerprint,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/contacts/delete") {
    const body = await readJson<
      { name?: unknown; fingerprint?: unknown; home?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const name = typeof body.name === "string" ? body.name : undefined;
    const fingerprint = typeof body.fingerprint === "string"
      ? body.fingerprint
      : undefined;
    const ctx = await getContext(home);
    const deletedName = await deleteContact(ctx, name, fingerprint);
    return json({ ok: true, name: deletedName });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/v1/contacts/resolve-opaque"
  ) {
    const body = await readJson<{
      fingerprint?: unknown;
      path?: unknown;
      value?: unknown;
      home?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const fingerprint = typeof body.fingerprint === "string"
      ? body.fingerprint
      : undefined;
    const path = typeof body.path === "string" ? body.path : undefined;
    const value = typeof body.value === "string" ? body.value : undefined;
    if (!fingerprint) {
      throw new HttpError(STATUS.BadRequest, "fingerprint is required");
    }
    if (!path || !path.startsWith("opaque::")) {
      throw new HttpError(STATUS.BadRequest, "path must start with opaque::");
    }
    if (!value) throw new HttpError(STATUS.BadRequest, "value is required");

    const ctx = await getContext(home);
    await updateContactRecord(ctx, fingerprint, contact => {
    const detailEntry = contact.details?.[path];
    const expectedHash = Array.isArray(detailEntry)
      ? detailEntry[0]
      : detailEntry;
    if (typeof expectedHash !== "string" || expectedHash.length === 0) {
      throw new HttpError(STATUS.NotFound, "opaque detail not found");
    }

    const candidateHash = sha256Hex(value);
    if (candidateHash !== expectedHash) {
      throw new HttpError(
        STATUS.BadRequest,
        "value does not match opaque detail hash",
      );
    }

    contact.resolvedOpaqueDetails = {
      ...(contact.resolvedOpaqueDetails ?? {}),
      [path]: value,
    };
    });
    return json({ ok: true, matched: true, path });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/api/v1/contacts/update-local-notes"
  ) {
    const body = await readJson<{
      fingerprint?: unknown;
      localAlias?: unknown;
      localDescription?: unknown;
      localEmail?: unknown;
      home?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const fingerprint = typeof body.fingerprint === "string"
      ? body.fingerprint
      : undefined;
    if (!fingerprint) {
      throw new HttpError(STATUS.BadRequest, "fingerprint is required");
    }

    const ctx = await getContext(home);
    await updateContactRecord(ctx, fingerprint, contact => {
    const raw = contact as Record<string, unknown>;
    if (typeof body.localAlias === "string") {
      raw.localAlias = body.localAlias || undefined;
    } else if (body.localAlias === null) {
      delete raw.localAlias;
    }
    if (typeof body.localDescription === "string") {
      raw.localDescription = body.localDescription || undefined;
    } else if (body.localDescription === null) {
      delete raw.localDescription;
    }
    if (typeof body.localEmail === "string") {
      raw.localEmail = body.localEmail || undefined;
    } else if (body.localEmail === null) {
      delete raw.localEmail;
    }
    });
    return json({ ok: true, fingerprint });
  }

  return null;
}
