import { MAX_ENCRYPTED_FILE_BYTES } from "../../common/FileLimits.ts";
import { Identity } from "../../core/Identity.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { type HdChange, type HdProfile } from "../../core/HdPath.ts";
import {
  apiUrl,
  type CLIContext,
  getContext,
  listIdentityNames,
  stableStringify,
} from "../../cli/utils.ts";
import {
  base64ToBytes,
  HttpError,
  randomHex,
  safeFileName,
  STATUS,
} from "./http.ts";
import { loadIdentityPublic, toSafeString } from "./identity.ts";
import {
  DEFAULT_MAIL_ACCOUNT,
  getMailStore,
  type MailAccountConfig,
  normalizeMailConfig,
  saveMailStore,
} from "./mail-account.ts";

export const EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE =
  "application/ebp-encrypted-attachment+json";

export type MailAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileDataBase64: string;
};

export type ParsedMailAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
};

export type MailRecipientInput = {
  contact: string;
  email: string;
};

export function parseMailAttachmentInputs(
  input: unknown,
): ParsedMailAttachmentInput[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new HttpError(
        STATUS.BadRequest,
        `attachment #${index + 1} is invalid`,
      );
    }
    const item = entry as Partial<MailAttachmentInput>;
    const fileName = safeFileName(
      typeof item.fileName === "string" ? item.fileName : "",
    );
    const mimeType =
      typeof item.mimeType === "string" && item.mimeType.trim().length > 0
        ? item.mimeType
        : "application/octet-stream";
    if (!fileName) {
      throw new HttpError(
        STATUS.BadRequest,
        `attachment #${index + 1} missing fileName`,
      );
    }
    if (
      typeof item.fileDataBase64 !== "string" || !item.fileDataBase64.length
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        `attachment #${index + 1} missing fileDataBase64`,
      );
    }
    const fileBytes = base64ToBytes(item.fileDataBase64);
    if (fileBytes.length > MAX_ENCRYPTED_FILE_BYTES) {
      throw new HttpError(
        STATUS.BadRequest,
        `attachment #${
          index + 1
        } exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
      );
    }
    return { fileName, mimeType, fileBytes };
  });
}

export function parseMailRecipientsInput(input: unknown): MailRecipientInput[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new HttpError(
        STATUS.BadRequest,
        `recipient #${index + 1} is invalid`,
      );
    }
    const item = entry as { contact?: unknown; email?: unknown };
    const contact = toSafeString(item.contact, 256);
    const email = toSafeString(item.email, 512);
    if (!contact) {
      throw new HttpError(
        STATUS.BadRequest,
        `recipient #${index + 1} missing contact`,
      );
    }
    if (!email) {
      throw new HttpError(
        STATUS.BadRequest,
        `recipient #${index + 1} missing email`,
      );
    }
    return { contact, email };
  });
}

export function formatMessageId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, "")}>`;
}

export function hashPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

export function sourceByteLength(source: unknown): number {
  if (typeof source === "string") {
    return new TextEncoder().encode(source).length;
  }
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof ArrayBuffer) return source.byteLength;
  return 0;
}

export function durationMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export function parseHdProfile(value: unknown): HdProfile {
  if (value === "dilithium" || value === "sphincs") return value;
  return "dilithium";
}

export function parseHdChange(value: unknown): HdChange {
  if (value === "internal") return "internal";
  return "external";
}

export function parseNonNegativeInteger(
  value: unknown,
  fallback: number,
): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
    ? Number.parseInt(value, 10)
    : fallback;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export type EbpMailConfig = {
  enabled: boolean;
  domain?: string;
  imap?: { host: string; port: number; secure: boolean };
  smtp?: { host: string; port: number; secure: boolean };
};

export async function fetchEbpMailConfig(
  server: string,
  mode?: "test",
): Promise<EbpMailConfig> {
  let res: Response;
  try {
    res = await fetch(apiUrl(server, "/api/v1/mail/signup/config"), mode ? {headers: {"x-ebp-mail-mode": mode}} : undefined);
  } catch (e) {
    throw new HttpError(
      STATUS.BadGateway,
      `key server unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return { enabled: false };
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new HttpError(
      STATUS.BadGateway,
      `mail sign-up config failed: HTTP ${res.status}`,
    );
  }
  return await res.json() as EbpMailConfig;
}

export type MailEndpoint = { host: string; port: number; secure: boolean };

export function checkoutOriginForServer(
  domain: string,
  server: string,
): string | null {
  const origin = new URL(server).origin;
  if (domain === "test.pqpost.com" && origin === "http://127.0.0.1:8789") {
    return origin;
  }
  if (
    domain === "test.pqpost.com" && origin === "https://test-api.pqpost.com"
  ) return "https://test.pqpost.com";
  if (domain === "pqpost.com" && origin === "https://keys.pqpost.com") {
    return "https://pqpost.com";
  }
  return null;
}

/**
 * The managed address for `identity`. Identities restored from a recovery
 * phrase carry no details, so fall back to the key server's verified record.
 */
export async function resolveManagedEmail(
  identity: Identity,
  server: string,
  domain: string,
): Promise<string> {
  const suffix = `@${domain.toLowerCase()}`;
  const local = identity.getDetail("email")?.toLowerCase();
  if (local && local.endsWith(suffix)) return local;
  let res: Response;
  try {
    res = await fetch(
      apiUrl(
        server,
        `/api/v1/identity/${encodeURIComponent(identity.toFingerprint())}`,
      ),
    );
  } catch (e) {
    throw new HttpError(
      STATUS.BadGateway,
      `key server unreachable: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!res.ok) {
    throw new HttpError(
      res.status >= 500 ? STATUS.BadGateway : STATUS.NotFound,
      res.status >= 500
        ? `key server could not look up this mailbox (HTTP ${res.status})`
        : `this identity has no verified ${suffix} mailbox on the key server`,
    );
  }
  const record = await res.json().catch(() => ({})) as {
    details?: Record<string, [string, string]>;
    detailsMeta?: Record<string, { verified?: boolean }>;
    revokedDetails?: string[];
  };
  const remote = record.details?.email?.[0]?.toLowerCase();
  const verified = record.detailsMeta?.email?.verified === true &&
    !(record.revokedDetails ?? []).includes("email");
  if (!remote || !verified || !remote.endsWith(suffix)) {
    throw new HttpError(
      STATUS.NotFound,
      `this identity has no verified ${suffix} mailbox on the key server`,
    );
  }
  return remote;
}

export async function saveEbpMailAccount(identityDir: string, options: {
  email: string;
  login: string;
  imap: MailEndpoint;
  smtp: MailEndpoint;
  fromName?: string;
}): Promise<{ accountId: string; accountConfig: MailAccountConfig }> {
  const accountConfig = normalizeMailConfig(DEFAULT_MAIL_ACCOUNT, {
    authType: "password",
    imapHost: options.imap.host,
    imapPort: options.imap.port,
    imapSecure: options.imap.secure,
    smtpHost: options.smtp.host,
    smtpPort: options.smtp.port,
    smtpSecure: options.smtp.secure,
    username: options.login,
    fromEmail: options.email,
    fromName: options.fromName ?? "",
    persistSecrets: true,
  });
  const store = await getMailStore(identityDir);
  const accountId = `mail-${randomHex(8)}`;
  const now = Date.now();
  store.accounts.push({
    id: accountId,
    name: "EBP Mail",
    config: accountConfig,
    createdAt: now,
    updatedAt: now,
  });
  store.selectedAccountId = accountId;
  await saveMailStore(identityDir, store);
  return { accountId, accountConfig };
}

export async function nextHdIdentityIndex(
  ctx: CLIContext,
  seed: Uint8Array,
  profile: HdProfile,
  account: number,
  change: HdChange,
): Promise<number> {
  const existing = new Set<string>();
  for (const name of await listIdentityNames(ctx.identityDir)) {
    const identityCtx = await getContext(undefined, name);
    try {
      const publicData = await loadIdentityPublic({
        ...identityCtx,
        identityDir: ctx.identityDir,
        contactsDir: ctx.contactsDir,
        identityPath: `${ctx.identityDir}/${name}.identity.json`,
      });
      if (publicData?.fingerprint) existing.add(publicData.fingerprint);
    } catch {
      // Ignore unreadable identity records during HD slot discovery.
    }
  }
  for (let index = 0; index < 100_000; index++) {
    const identity = Identity.fromAccount(seed, {
      profile,
      account,
      change,
      index,
    });
    if (!existing.has(identity.toFingerprint())) return index;
  }
  throw new HttpError(
    STATUS.BadRequest,
    "unable to find unused HD identity slot",
  );
}
