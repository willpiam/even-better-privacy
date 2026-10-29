import type { ExternalIdentity } from "../../core/Identity.ts";
import { apiUrl, type CLIContext } from "../../cli/utils.ts";
import {
  decideRecipientResolution,
  matchVerifiedEmailIdentities,
  searchVerifiedEmailIdentity,
  type EmailIdentityCandidate,
  type VerifiedEmailPage,
} from "../../core/VerifiedEmailMatch.ts";
import { HttpError, json, STATUS } from "./http.ts";
import { resolveServer } from "./identity.ts";
import { listContacts, saveExternalContact } from "./contacts.ts";

type IdentityPayload = EmailIdentityCandidate & {
  signingKeyType?: string;
  encryptionKeyType?: string;
  signingKey?: string;
  encryptionKey?: string;
  signingKeyDetails?: ExternalIdentity["signingKeyDetails"];
  encryptionKeyDetails?: ExternalIdentity["encryptionKeyDetails"];
};

function publishedOrLocalEmail(contact: ExternalIdentity): string {
  const raw = contact.details?.email;
  const published = Array.isArray(raw) && typeof raw[0] === "string" ? raw[0] : "";
  const local = (contact as ExternalIdentity & { localEmail?: unknown }).localEmail;
  const localEmail = typeof local === "string" ? local : "";
  return (published || localEmail).trim().toLowerCase();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function asCandidate(value: unknown): EmailIdentityCandidate | null {
  const obj = asRecord(value);
  if (!obj || typeof obj.fingerprint !== "string" || !obj.fingerprint) return null;
  return {
    fingerprint: obj.fingerprint,
    revoked: obj.revoked === true,
    details: asRecord(obj.details),
    detailsMeta: asRecord(obj.detailsMeta),
    revokedDetails: Array.isArray(obj.revokedDetails)
      ? obj.revokedDetails.filter((path): path is string => typeof path === "string")
      : [],
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body = await res.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function fetchSearchPage(
  server: string,
  email: string,
  page: number,
  limit: number,
): Promise<VerifiedEmailPage> {
  const url = new URL(apiUrl(server, "/api/v1/identities/search"));
  url.searchParams.set("query", email.trim().toLowerCase());
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url);
  const body = await readJson(res);
  if (!res.ok) {
    const reason = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new HttpError(STATUS.BadGateway, `failed to search identities: ${reason}`);
  }
  const identities = Array.isArray(body.identities)
    ? body.identities.map(asCandidate).filter((item): item is EmailIdentityCandidate => item !== null)
    : [];
  const pagination = asRecord(body.pagination);
  const hasMore = pagination?.hasMore === true;
  const pageNumber = typeof pagination?.page === "number" ? pagination.page : page;
  const totalPages = typeof pagination?.totalPages === "number" ? pagination.totalPages : page;
  return {
    identities,
    hasNextPage: hasMore || pageNumber < totalPages,
  };
}

function toExternal(identity: IdentityPayload, fingerprint: string): ExternalIdentity {
  const details = { ...(identity.details ?? {}) } as ExternalIdentity["details"];
  const detailsMeta = {
    ...(identity.detailsMeta ?? {}),
  } as ExternalIdentity["detailsMeta"];
  for (const path of identity.revokedDetails ?? []) {
    delete details[path];
    delete detailsMeta?.[path];
  }
  return {
    fingerprint: identity.fingerprint || fingerprint,
    signingKeyType: identity.signingKeyType === "sphincs" ? "sphincs" : "dilithium",
    encryptionKeyType: "kyber",
    signingKey: typeof identity.signingKey === "string" ? identity.signingKey : "",
    encryptionKey: typeof identity.encryptionKey === "string" ? identity.encryptionKey : "",
    signingKeyDetails: identity.signingKeyDetails ?? { variant: "ml_dsa87" },
    encryptionKeyDetails: identity.encryptionKeyDetails ?? { variant: "ml_kem1024" },
    details,
    detailsMeta,
    revoked: identity.revoked === true,
    revokedDetails: identity.revokedDetails ?? [],
  };
}

async function fetchIdentity(server: string, fingerprint: string): Promise<IdentityPayload> {
  const res = await fetch(apiUrl(server, `/api/v1/identity/${encodeURIComponent(fingerprint)}`));
  const body = await readJson(res);
  if (!res.ok) {
    const reason = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new HttpError(STATUS.BadGateway, `failed to fetch identity: ${reason}`);
  }
  const candidate = asCandidate(body);
  if (!candidate?.fingerprint) {
    throw new HttpError(STATUS.BadGateway, "invalid identity payload from server");
  }
  return { ...body, ...candidate };
}

export async function resolveVerifiedEmailContact(
  ctx: CLIContext,
  email: string,
  serverOverride?: string,
): Promise<Response> {
  const trimmed = email.trim();
  if (!trimmed.includes("@")) return json({ status: "none" });

  const contacts = await listContacts(ctx);
  const normalized = trimmed.toLowerCase();
  const localEmailMatches = contacts
    .filter((item) => publishedOrLocalEmail(item.contact) === normalized)
    .map((item) => ({ name: item.name, fingerprint: item.contact.fingerprint }));
  const localFingerprintMatches = contacts.map((item) => ({
    name: item.name,
    fingerprint: item.contact.fingerprint,
  }));

  const serverMatch = localEmailMatches.length === 0
    ? await searchVerifiedEmailIdentity(
      trimmed,
      (page, limit) => fetchSearchPage(resolveServer(ctx, serverOverride), trimmed, page, limit),
    )
    : { status: "none" as const };

  const decision = decideRecipientResolution({
    localEmailMatches,
    serverMatch,
    localFingerprintMatches,
  });

  if (decision.action === "use") {
    const chosen = contacts.find((item) => item.name === decision.name);
    return json({
      status: "unique",
      name: decision.name,
      fingerprint: chosen?.contact.fingerprint ?? "",
      imported: false,
    });
  }
  if (decision.action === "unresolved") {
    const status = localEmailMatches.length > 1 || serverMatch.status === "ambiguous"
      ? "ambiguous"
      : "none";
    return json({ status });
  }

  const server = resolveServer(ctx, serverOverride);
  const identity = await fetchIdentity(server, decision.fingerprint);
  const confirmed = matchVerifiedEmailIdentities([identity], trimmed);
  if (confirmed.status !== "unique" || confirmed.fingerprint !== decision.fingerprint) {
    return json({ status: "none" });
  }
  const saved = await saveExternalContact(ctx, toExternal(identity, decision.fingerprint));
  return json({
    status: "unique",
    name: saved.name,
    fingerprint: saved.fingerprint,
    imported: true,
  });
}
