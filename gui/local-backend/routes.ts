import nodemailer from "nodemailer";
import { type ExternalIdentity, Identity } from "../../core/Identity.ts";
import { FILE_FORMAT_VERSIONS, PROTOCOL_VERSION } from "../../core/version.ts";
import { COMPONENT_VERSIONS } from "../../app-version.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import {
  type MultiRecipientAttachmentManifestEntry,
  sha256Hex,
} from "../../core/MessageHash.ts";
import { MultiRecipientCipher } from "../../core/MultiRecipientCipher.ts";
import {
  createHierarchyCertificate,
  decodeHierarchyCertificate,
  getHierarchySignaturePayload,
  isHierarchyCertificateExpired,
} from "../../core/HierarchyCertificate.ts";
import { hexToBytes, stringToHex } from "../../core/Hex.ts";
import {
  buildDetachedSignaturePayload,
  buildEncryptedMessagePayload,
  buildEncryptedSignedMessageMultiPayload,
  buildEncryptedSignedMessagePayload,
  buildSignedMessagePayload,
} from "../../core/Payloads.ts";
import {
  createFileCleartextEnvelope,
  MAX_ENCRYPTED_FILE_BYTES,
  parseFileCleartextEnvelope,
} from "../../core/FilePayload.ts";
import {
  createEmailAttachmentCleartextEnvelope,
  parseEmailAttachmentCleartextEnvelope,
  parseEncryptedEmailAttachmentPayload,
} from "../../core/EmailAttachmentPayload.ts";
import {
  apiUrl,
  buildStateFromExternal,
  type CLIContext,
  computeStateHash,
  ensureDir,
  ensurePrivateDir,
  getContext,
  listIdentityNames,
  readState,
  stableStringify,
  updateState,
} from "../../cli/utils.ts";

import {
  base64ToBytes,
  bytesToBase64,
  CORS_HEADERS,
  ENCRYPTED_FILE_FORMAT_VERSION,
  ENCRYPTED_SIGNED_FILE_FORMAT_VERSION,
  HttpError,
  json,
  randomHex,
  readJson,
  safeFileName,
  STATUS,
  tryServeStatic,
} from "./http.ts";
import {
  applyCorsHeaders,
  getCsrfToken,
  validateSecurity,
} from "./security.ts";
import {
  loadIdentity,
  loadIdentityPublic,
  resolveServer,
  saveIdentity,
  toSafeString,
} from "./identity.ts";
import {
  computeExternalFingerprint,
  deleteContact,
  findContactRecord,
  listContacts,
  loadContact,
} from "./contacts.ts";
import {
  buildSmtpAuth,
  DEFAULT_MAIL_ACCOUNT,
  getMailSecretsStatus,
  getMailSecretsStore,
  getMailStore,
  isMailOauthProvider,
  type MailAccountRecord,
  type MailAuthSecrets,
  type MailOauthProvider,
  mailPinCache,
  normalizeMailConfig,
  resolveMailAccount,
  saveMailSecretsStore,
  saveMailStore,
  unlockMailSecretsWithPin,
} from "./mail-account.ts";
import {
  buildImapClient,
  extractEbpPayload,
  extractEmailAddress,
  getAddressText,
  getIdentityDetailMeta,
  getIdentityDetailValue,
  parseMailSourceInWorker,
  safeImapDisconnect,
  withImapReconnect,
  withMailboxLock,
  withTimeout,
} from "./mail-imap.ts";
import {
  exchangeOAuthCode,
  getMailOAuthRedirectUri,
  getOAuthProviderConfig,
  mailOauthCompleted,
  mailOauthStarts,
  pruneExpiredOAuthState,
} from "./mail-oauth.ts";
import {
  addPendingHierarchyLocal,
  buildHierarchyTreeFromCertificates,
  decodeHierarchyCertificateDraft,
  fingerprintColor,
  listHierarchyCertificatesLocal,
  readPendingHierarchyLocal,
  storeHierarchyCertificateLocal,
  writePendingHierarchyLocal,
} from "./hierarchy-local.ts";

const EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE =
  "application/ebp-encrypted-attachment+json";

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

type MailAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileDataBase64: string;
};

type ParsedMailAttachmentInput = {
  fileName: string;
  mimeType: string;
  fileBytes: Uint8Array;
};

type MailRecipientInput = {
  contact: string;
  email: string;
};

function parseMailAttachmentInputs(
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

function parseMailRecipientsInput(input: unknown): MailRecipientInput[] {
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

function hashPayload(payload: unknown): string {
  return sha256Hex(stableStringify(payload));
}

function sourceByteLength(source: unknown): number {
  if (typeof source === "string") {
    return new TextEncoder().encode(source).length;
  }
  if (source instanceof Uint8Array) return source.byteLength;
  if (source instanceof ArrayBuffer) return source.byteLength;
  return 0;
}

function durationMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export async function handleRequest(req: Request): Promise<Response> {
  const rejected = validateSecurity(req);
  if (rejected) return applyCorsHeaders(req, rejected);
  return applyCorsHeaders(req, await handleRequestInternal(req));
}

async function handleRequestInternal(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    const staticResponse = await tryServeStatic(req, url);
    if (staticResponse) return staticResponse;

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      return json({
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/csrf-token") {
      return json({ token: getCsrfToken() });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/context") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const state = await readState(ctx.identityDir);
      return json({
        identityDir: ctx.identityDir,
        contactsDir: ctx.contactsDir,
        currentIdentity: ctx.currentIdentity,
        server: state?.server ?? null,
        protocolVersion: PROTOCOL_VERSION,
        componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/oauth/start") {
      const body = await readJson<{ provider?: unknown; home?: unknown }>(req);
      const providerRaw = toSafeString(body.provider, 64).toLowerCase();
      if (!isMailOauthProvider(providerRaw)) {
        throw new HttpError(
          STATUS.BadRequest,
          "provider must be gmail or outlook",
        );
      }
      const provider = providerRaw as Exclude<MailOauthProvider, "">;
      const home = typeof body.home === "string" ? body.home : undefined;
      const ctx = await getContext(home ?? undefined);
      const serverUrl = resolveServer(ctx);
      const conf = getOAuthProviderConfig(provider);
      pruneExpiredOAuthState();
      const oauthState = randomHex(24);
      mailOauthStarts.set(oauthState, {
        provider,
        createdAt: Date.now(),
        serverUrl,
      });
      const authUrl = new URL(conf.authUrl);
      authUrl.searchParams.set("client_id", conf.clientId);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("redirect_uri", getMailOAuthRedirectUri());
      authUrl.searchParams.set("scope", conf.scopes.join(" "));
      authUrl.searchParams.set("state", oauthState);
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("access_type", "offline");
      return json({
        ok: true,
        oauthState,
        provider,
        authUrl: authUrl.toString(),
      });
    }

    if (
      req.method === "GET" && url.pathname === "/api/v1/mail/oauth/callback"
    ) {
      const code = toSafeString(url.searchParams.get("code"), 4096);
      const oauthState = toSafeString(url.searchParams.get("state"), 256);
      const err = toSafeString(url.searchParams.get("error"), 256);
      pruneExpiredOAuthState();
      const pending = mailOauthStarts.get(oauthState);
      if (!oauthState || !pending) {
        return new Response(
          "<!doctype html><html><body><h3>OAuth failed: invalid or expired state.</h3></body></html>",
          {
            status: STATUS.BadRequest,
            headers: {
              "content-type": "text/html; charset=utf-8",
              ...CORS_HEADERS,
            },
          },
        );
      }
      if (err) {
        mailOauthStarts.delete(oauthState);
        return new Response(
          `<!doctype html><html><body><h3>OAuth failed: ${
            escapeHtml(err)
          }</h3></body></html>`,
          {
            status: STATUS.BadRequest,
            headers: {
              "content-type": "text/html; charset=utf-8",
              ...CORS_HEADERS,
            },
          },
        );
      }
      try {
        const exchanged = await exchangeOAuthCode(
          pending.serverUrl,
          pending.provider,
          code,
        );
        mailOauthCompleted.set(oauthState, {
          provider: pending.provider,
          createdAt: Date.now(),
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          tokenExpiry: exchanged.tokenExpiry,
          email: exchanged.email,
        });
        mailOauthStarts.delete(oauthState);
        const payload = JSON.stringify({
          type: "ebp-mail-oauth-complete",
          ok: true,
          oauthState,
          provider: pending.provider,
          email: exchanged.email,
        });
        return new Response(
          `<!doctype html><html><body><h3>Email account connected.</h3><p>You can close this window.</p><script>try{if(window.opener&&!window.opener.closed){window.opener.postMessage(${payload},"*");}setTimeout(()=>window.close(),300);}catch{}</script></body></html>`,
          {
            status: STATUS.OK,
            headers: {
              "content-type": "text/html; charset=utf-8",
              ...CORS_HEADERS,
            },
          },
        );
      } catch (oauthErr) {
        mailOauthStarts.delete(oauthState);
        const message = oauthErr instanceof HttpError
          ? oauthErr.message
          : "oauth callback failed";
        return new Response(
          `<!doctype html><html><body><h3>OAuth failed: ${
            escapeHtml(message)
          }</h3></body></html>`,
          {
            status: STATUS.BadGateway,
            headers: {
              "content-type": "text/html; charset=utf-8",
              ...CORS_HEADERS,
            },
          },
        );
      }
    }

    // Poll for OAuth completion (used when the popup couldn't be opened
    // and the auth URL was opened in the system browser instead).
    if (req.method === "GET" && url.pathname === "/api/v1/mail/oauth/poll") {
      const oauthState = toSafeString(url.searchParams.get("state"), 256);
      if (!oauthState) {
        throw new HttpError(STATUS.BadRequest, "state is required");
      }
      const completed = mailOauthCompleted.get(oauthState);
      if (completed) {
        return json({
          status: "complete",
          type: "ebp-mail-oauth-complete",
          ok: true,
          oauthState,
          provider: completed.provider,
          email: completed.email,
        });
      }
      const pending = mailOauthStarts.get(oauthState);
      if (pending) {
        return json({ status: "pending" });
      }
      return json({ status: "unknown" });
    }

    // Open a URL in the user's default system browser.
    // Used for OAuth flows where the URL must open in a real browser rather
    // than the Tauri/WebKitGTK webview (which causes "Popup blocked" errors).
    if (
      req.method === "POST" &&
      url.pathname === "/api/v1/mail/oauth/open-browser"
    ) {
      const body = await readJson<{ url?: unknown }>(req);
      const targetUrl = typeof body.url === "string" ? body.url.trim() : "";
      if (!targetUrl) throw new HttpError(STATUS.BadRequest, "url is required");
      // Only allow opening https:// and http://127.0.0.1 URLs for safety.
      if (
        !targetUrl.startsWith("https://") &&
        !targetUrl.startsWith("http://127.0.0.1")
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "url must be https or http://127.0.0.1",
        );
      }
      const os = Deno.build.os;
      // Try multiple openers on Linux — xdg-open may not be available inside
      // some AppImage or container environments.
      const openers: string[][] = [];
      if (os === "linux") {
        openers.push(["xdg-open", targetUrl]);
        openers.push(["gio", "open", targetUrl]);
        openers.push(["sensible-browser", targetUrl]);
      } else if (os === "darwin") {
        openers.push(["open", targetUrl]);
      } else if (os === "windows") {
        // cmd /c start breaks URLs containing & because cmd.exe treats & as
        // a command separator, truncating the OAuth URL before response_type.
        // rundll32 invokes the URL protocol handler directly without shell
        // interpretation; powershell Start-Process is a secondary fallback.
        openers.push(["rundll32", "url.dll,FileProtocolHandler", targetUrl]);
        openers.push([
          "powershell",
          "-NoProfile",
          "-Command",
          `Start-Process '${targetUrl.replace(/'/g, "''")}'`,
        ]);
      } else {
        throw new HttpError(
          STATUS.InternalServerError,
          `unsupported OS for open-browser: ${os}`,
        );
      }
      let opened = false;
      for (const cmd of openers) {
        try {
          const proc = new Deno.Command(cmd[0], {
            args: cmd.slice(1),
            stdout: "null",
            stderr: "null",
          });
          const output = await proc.output();
          if (output.success) {
            opened = true;
            break;
          }
        } catch {
          // This opener isn't available — try next.
        }
      }
      if (!opened) {
        throw new HttpError(
          STATUS.InternalServerError,
          "could not open system browser — xdg-open, gio, and sensible-browser all failed",
        );
      }
      return json({ ok: true });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/mail/oauth/complete"
    ) {
      const body = await readJson<{
        home?: unknown;
        oauthState?: unknown;
        accountId?: unknown;
        createNew?: unknown;
        accountName?: unknown;
        pin?: unknown;
      }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const oauthState = toSafeString(body.oauthState, 256);
      if (!oauthState) {
        throw new HttpError(STATUS.BadRequest, "oauthState is required");
      }
      const pending = mailOauthCompleted.get(oauthState);
      if (!pending) {
        throw new HttpError(STATUS.Conflict, "oauth flow is not completed yet");
      }
      const ctx = await getContext(home ?? undefined);
      const requestedAccountId = toSafeString(body.accountId, 128);
      const createNew = Boolean(body.createNew);
      const accountName = toSafeString(body.accountName, 128) || "Mail account";
      const pin = typeof body.pin === "string" ? body.pin : "";
      const store = await getMailStore(ctx.identityDir);
      const current = createNew
        ? null
        : requestedAccountId
        ? store.accounts.find((entry) => entry.id === requestedAccountId)
        : (store.selectedAccountId
          ? store.accounts.find((entry) => entry.id === store.selectedAccountId)
          : null);
      const conf = getOAuthProviderConfig(pending.provider);
      const accountConfig = normalizeMailConfig(
        current?.config ?? DEFAULT_MAIL_ACCOUNT,
        {
          authType: "oauth",
          oauthProvider: pending.provider,
          imapHost: conf.imapHost,
          imapPort: conf.imapPort,
          imapSecure: conf.imapSecure,
          smtpHost: conf.smtpHost,
          smtpPort: conf.smtpPort,
          smtpSecure: conf.smtpSecure,
          username: pending.email,
          fromEmail: pending.email,
          fromName: current?.config.fromName ?? "",
          persistSecrets: true,
        },
      );
      const accountId = current?.id ?? `mail-${randomHex(8)}`;
      const now = Date.now();
      const nextRecord: MailAccountRecord = {
        id: accountId,
        name: accountName,
        config: accountConfig,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      if (current) {
        store.accounts = store.accounts.map((entry) =>
          entry.id === accountId ? nextRecord : entry
        );
      } else {
        store.accounts.push(nextRecord);
      }
      store.selectedAccountId = accountId;
      await saveMailStore(ctx.identityDir, store);
      if (pin) {
        mailPinCache.set(ctx.identityDir, pin);
      }
      const secretStore = await getMailSecretsStore(ctx.identityDir);
      secretStore[accountId] = {
        imapPassword: "",
        smtpPassword: "",
        accessToken: pending.accessToken,
        refreshToken: pending.refreshToken,
        tokenExpiry: pending.tokenExpiry,
      };
      await saveMailSecretsStore(ctx.identityDir, secretStore);
      mailOauthCompleted.delete(oauthState);
      return json({
        ok: true,
        accountId,
        accountName: nextRecord.name,
        account: accountConfig,
        selectedAccountId: store.selectedAccountId,
        hasImapPassword: false,
        hasSmtpPassword: false,
        hasAccessToken: true,
        localOnly: true,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/mail/account") {
      const home = url.searchParams.get("home") ?? undefined;
      const requestedAccountId =
        toSafeString(url.searchParams.get("accountId"), 128) || undefined;
      const ctx = await getContext(home ?? undefined);
      const store = await getMailStore(ctx.identityDir);
      const selectedId = requestedAccountId ?? store.selectedAccountId ??
        store.accounts[0]?.id ?? null;
      const account = selectedId
        ? (store.accounts.find((entry) => entry.id === selectedId) ?? null)
        : null;
      const secretStatus = await getMailSecretsStatus(ctx.identityDir);
      const secrets = account && secretStatus.store
        ? secretStatus.store[account.id]
        : undefined;
      return json({
        accountId: account?.id ?? null,
        accountName: account?.name ?? null,
        account: account?.config ?? null,
        selectedAccountId: store.selectedAccountId ?? account?.id ?? null,
        accounts: store.accounts.map((entry) => ({
          id: entry.id,
          name: entry.name,
        })),
        hasImapPassword: Boolean(secrets?.imapPassword),
        hasSmtpPassword: Boolean(secrets?.smtpPassword),
        hasAccessToken: Boolean(secrets?.accessToken),
        secretsInMemory: secretStatus.inMemory,
        secretsLocked: secretStatus.locked,
        localOnly: true,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/mail/accounts") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const store = await getMailStore(ctx.identityDir);
      const secretStatus = await getMailSecretsStatus(ctx.identityDir);
      const secretStore = secretStatus.store ?? {};
      return json({
        selectedAccountId: store.selectedAccountId,
        secretsInMemory: secretStatus.inMemory,
        secretsLocked: secretStatus.locked,
        accounts: store.accounts.map((entry) => ({
          id: entry.id,
          name: entry.name,
          updatedAt: entry.updatedAt,
          username: entry.config.username,
          fromEmail: entry.config.fromEmail,
          imapHost: entry.config.imapHost,
          smtpHost: entry.config.smtpHost,
          authType: entry.config.authType ?? "password",
          oauthProvider: entry.config.oauthProvider ?? "",
          persistSecrets: entry.config.persistSecrets,
          hasStoredSecret: secretStatus.locked
            ? null
            : Boolean(secretStore[entry.id]),
        })),
      });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/mail/account/select"
    ) {
      const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const accountId = toSafeString(body.accountId, 128);
      if (!accountId) {
        throw new HttpError(STATUS.BadRequest, "accountId is required");
      }
      const ctx = await getContext(home ?? undefined);
      const store = await getMailStore(ctx.identityDir);
      const exists = store.accounts.some((entry) => entry.id === accountId);
      if (!exists) {
        throw new HttpError(STATUS.NotFound, "mail account not found");
      }
      store.selectedAccountId = accountId;
      await saveMailStore(ctx.identityDir, store);
      return json({ ok: true, selectedAccountId: accountId });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/mail/account/delete"
    ) {
      const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const accountId = toSafeString(body.accountId, 128);
      if (!accountId) {
        throw new HttpError(STATUS.BadRequest, "accountId is required");
      }
      const ctx = await getContext(home ?? undefined);
      const store = await getMailStore(ctx.identityDir);
      const exists = store.accounts.some((entry) => entry.id === accountId);
      if (!exists) {
        throw new HttpError(STATUS.NotFound, "mail account not found");
      }

      const secretStatus = await getMailSecretsStatus(ctx.identityDir);
      if (secretStatus.locked) {
        throw new HttpError(STATUS.Unauthorized, "email pin required");
      }
      store.accounts = store.accounts.filter((entry) => entry.id !== accountId);
      if (store.selectedAccountId === accountId) {
        store.selectedAccountId = store.accounts[0]?.id ?? null;
      }
      await saveMailStore(ctx.identityDir, store);
      const secretStore = secretStatus.store ?? {};
      if (secretStore[accountId]) {
        delete secretStore[accountId];
        await saveMailSecretsStore(ctx.identityDir, secretStore);
      }
      return json({
        ok: true,
        deletedAccountId: accountId,
        selectedAccountId: store.selectedAccountId,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/unlock") {
      const body = await readJson<{ home?: unknown; pin?: unknown }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const pin = typeof body.pin === "string" ? body.pin : "";
      if (!pin) throw new HttpError(STATUS.BadRequest, "email pin is required");
      const ctx = await getContext(home ?? undefined);
      const store = await unlockMailSecretsWithPin(ctx.identityDir, pin);
      return json({
        ok: true,
        unlocked: true,
        accountCount: Object.keys(store).length,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/account") {
      const body = await readJson<{
        home?: unknown;
        account?: unknown;
        accountId?: unknown;
        createNew?: unknown;
        accountName?: unknown;
        imapPassword?: unknown;
        smtpPassword?: unknown;
        pin?: unknown;
      }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const ctx = await getContext(home ?? undefined);
      const accountPayload = body.account && typeof body.account === "object"
        ? body.account as Record<string, unknown>
        : null;
      const requestedAccountId = toSafeString(body.accountId, 128);
      const createNew = Boolean(body.createNew);
      const accountName = toSafeString(body.accountName, 128) || "Mail account";
      const pin = typeof body.pin === "string" ? body.pin : "";
      const store = await getMailStore(ctx.identityDir);
      const current = createNew
        ? null
        : requestedAccountId
        ? store.accounts.find((entry) => entry.id === requestedAccountId)
        : (store.selectedAccountId
          ? store.accounts.find((entry) => entry.id === store.selectedAccountId)
          : null);
      const accountConfig = normalizeMailConfig(
        current?.config ?? DEFAULT_MAIL_ACCOUNT,
        accountPayload,
      );
      const accountId = current?.id ?? `mail-${randomHex(8)}`;
      const now = Date.now();
      const nextRecord: MailAccountRecord = {
        id: accountId,
        name: accountName,
        config: accountConfig,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      if (current) {
        store.accounts = store.accounts.map((entry) =>
          entry.id === accountId ? nextRecord : entry
        );
      } else {
        store.accounts.push(nextRecord);
      }
      store.selectedAccountId = accountId;
      await saveMailStore(ctx.identityDir, store);

      if (pin) {
        mailPinCache.set(ctx.identityDir, pin);
      }
      const secretStore = await getMailSecretsStore(ctx.identityDir);
      const existingSecrets = secretStore[accountId] ??
        { imapPassword: "", smtpPassword: "" };
      const nextSecrets: MailAuthSecrets = {
        imapPassword:
          typeof body.imapPassword === "string" && body.imapPassword.length > 0
            ? body.imapPassword
            : existingSecrets.imapPassword,
        smtpPassword:
          typeof body.smtpPassword === "string" && body.smtpPassword.length > 0
            ? body.smtpPassword
            : existingSecrets.smtpPassword,
        accessToken: existingSecrets.accessToken,
        refreshToken: existingSecrets.refreshToken,
        tokenExpiry: existingSecrets.tokenExpiry,
      };
      if (accountConfig.authType === "oauth") {
        nextSecrets.imapPassword = "";
        nextSecrets.smtpPassword = "";
      }
      secretStore[accountId] = nextSecrets;
      if (!accountConfig.persistSecrets) {
        delete secretStore[accountId];
      }
      await saveMailSecretsStore(ctx.identityDir, secretStore);
      return json({
        ok: true,
        accountId,
        accountName: nextRecord.name,
        account: accountConfig,
        selectedAccountId: store.selectedAccountId,
        hasImapPassword: Boolean(nextSecrets.imapPassword),
        hasSmtpPassword: Boolean(nextSecrets.smtpPassword),
        hasAccessToken: Boolean(nextSecrets.accessToken),
        localOnly: true,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/test") {
      const body = await readJson<{ home?: unknown; accountId?: unknown }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const accountId = toSafeString(body.accountId, 128) || undefined;
      const ctx = await getContext(home ?? undefined);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const account = resolved.account.config;
      const secrets = resolved.secrets;

      const imap = buildImapClient(account, secrets);
      try {
        await imap.connect();
        await withMailboxLock(imap, "INBOX", async () => {
          // lock acquire itself validates mailbox open/access
        });
      } finally {
        safeImapDisconnect(imap);
      }

      const transport = nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: buildSmtpAuth(account, secrets),
      });
      await transport.verify();
      return json({ ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/mail/messages") {
      const requestStartedAt = performance.now();
      const home = url.searchParams.get("home") ?? undefined;
      const accountId = toSafeString(url.searchParams.get("accountId"), 128) ||
        undefined;
      const folder =
        toSafeString(url.searchParams.get("folder") ?? "INBOX", 128) || "INBOX";
      const limit = Math.max(
        1,
        Math.min(100, Number(url.searchParams.get("limit") ?? "20") || 20),
      );
      const searchQuery = toSafeString(url.searchParams.get("search"), 256) ||
        "";
      const pageRaw = Math.max(
        1,
        Number(url.searchParams.get("page") ?? "1") || 1,
      );
      const resolveStartedAt = performance.now();
      const ctx = await getContext(home ?? undefined);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const resolveMs = durationMs(resolveStartedAt);
      const account = resolved.account.config;
      const secrets = resolved.secrets;
      let mailboxExists = 0;
      let fetchedCount = 0;
      let searchMs = 0;
      let fetchMs = 0;

      try {
        const response = await withImapReconnect(
          account,
          secrets,
          async (imap) => {
            return await withMailboxLock(imap, folder, async () => {
              const mailboxRaw = imap.mailbox as
                | { exists?: number }
                | false
                | undefined;
              mailboxExists = mailboxRaw && typeof mailboxRaw === "object"
                ? Number(mailboxRaw.exists ?? 0)
                : 0;
              if (!mailboxExists) {
                return json({
                  folder,
                  messages: [],
                  pagination: { page: 1, totalPages: 1, total: 0 },
                  _timing: {
                    resolveMs,
                    oauthMs: resolved.oauthRefreshMs,
                    searchMs,
                    fetchMs,
                    totalMs: durationMs(requestStartedAt),
                    mailboxExists,
                    fetchedCount,
                  },
                });
              }

              const fetchOpts = {
                uid: true,
                envelope: true,
                internalDate: true,
                flags: true,
                size: true,
              };
              const buildResult = (msg: unknown) => ({
                uid: (msg as { uid?: number }).uid,
                subject: (msg as { envelope?: { subject?: string } }).envelope
                  ?.subject ?? "(no subject)",
                from: getAddressText(
                  (msg as { envelope?: { from?: unknown } }).envelope?.from,
                ),
                to: getAddressText(
                  (msg as { envelope?: { to?: unknown } }).envelope?.to,
                ),
                date: (msg as { internalDate?: string | Date }).internalDate
                  ? new Date(
                    (msg as { internalDate: string | Date }).internalDate,
                  ).getTime()
                  : null,
                seen: Array.isArray((msg as { flags?: string[] }).flags)
                  ? (msg as { flags: string[] }).flags.includes("\\Seen")
                  : false,
                size: typeof (msg as { size?: number }).size === "number"
                  ? (msg as { size: number }).size
                  : null,
              });

              if (searchQuery) {
                const searchStartedAt = performance.now();
                const uids = await imap.search(
                  {
                    or: [{ from: searchQuery }, { subject: searchQuery }, {
                      body: searchQuery,
                    }],
                  },
                  { uid: true },
                );
                searchMs = durationMs(searchStartedAt);
                if (!uids || uids.length === 0) {
                  return json({
                    accountId: resolved.account.id,
                    folder,
                    messages: [],
                    pagination: { page: 1, totalPages: 1, total: 0 },
                  });
                }
                const total = uids.length;
                const totalPages = Math.ceil(total / limit);
                const page = Math.min(pageRaw, totalPages);
                const sliceEnd = total - (page - 1) * limit;
                const sliceStart = Math.max(0, sliceEnd - limit);
                const uidSlice = uids.slice(sliceStart, sliceEnd);
                const results: Array<Record<string, unknown>> = [];
                const fetchStartedAt = performance.now();
                for await (
                  const msg of imap.fetch(uidSlice.join(","), fetchOpts, {
                    uid: true,
                  })
                ) {
                  results.push(buildResult(msg));
                }
                fetchMs = durationMs(fetchStartedAt);
                fetchedCount = results.length;
                results.reverse();
                return json({
                  accountId: resolved.account.id,
                  folder,
                  messages: results,
                  pagination: { page, totalPages, total },
                  _timing: {
                    resolveMs,
                    oauthMs: resolved.oauthRefreshMs,
                    searchMs,
                    fetchMs,
                    totalMs: durationMs(requestStartedAt),
                    mailboxExists,
                    fetchedCount,
                  },
                });
              }

              const total = mailboxExists;
              const totalPages = Math.ceil(total / limit);
              const page = Math.min(pageRaw, totalPages);
              const end = total - (page - 1) * limit;
              const start = Math.max(1, end - limit + 1);
              const range = `${start}:${end}`;
              const results: Array<Record<string, unknown>> = [];
              const fetchStartedAt = performance.now();
              for await (const msg of imap.fetch(range, fetchOpts)) {
                results.push(buildResult(msg));
              }
              fetchMs = durationMs(fetchStartedAt);
              fetchedCount = results.length;
              results.reverse();
              return json({
                accountId: resolved.account.id,
                folder,
                messages: results,
                pagination: { page, totalPages, total },
                _timing: {
                  resolveMs,
                  oauthMs: resolved.oauthRefreshMs,
                  searchMs,
                  fetchMs,
                  totalMs: durationMs(requestStartedAt),
                  mailboxExists,
                  fetchedCount,
                },
              });
            });
          },
        );
        console.warn(
          `mail/messages account=${resolved.account.id} folder=${folder} search=${
            searchQuery ? "yes" : "no"
          } resolveMs=${resolveMs} oauthMs=${
            resolved.oauthRefreshMs ?? 0
          } searchMs=${searchMs} fetchMs=${fetchMs} totalMs=${
            durationMs(requestStartedAt)
          } mailboxExists=${mailboxExists} fetchedCount=${fetchedCount}`,
        );
        return response;
      } catch (err) {
        console.warn(
          `mail/messages error account=${resolved.account.id} folder=${folder} search=${
            searchQuery ? "yes" : "no"
          } resolveMs=${resolveMs} oauthMs=${
            resolved.oauthRefreshMs ?? 0
          } searchMs=${searchMs} fetchMs=${fetchMs} totalMs=${
            durationMs(requestStartedAt)
          } mailboxExists=${mailboxExists} fetchedCount=${fetchedCount} error=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/v1/mail/message") {
      const requestStartedAt = performance.now();
      const home = url.searchParams.get("home") ?? undefined;
      const accountId = toSafeString(url.searchParams.get("accountId"), 128) ||
        undefined;
      const folder =
        toSafeString(url.searchParams.get("folder") ?? "INBOX", 128) || "INBOX";
      const uidRaw = url.searchParams.get("uid");
      const uid = Number(uidRaw);
      if (!Number.isInteger(uid) || uid <= 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "uid must be a positive integer",
        );
      }
      const resolveStartedAt = performance.now();
      const ctx = await getContext(home ?? undefined);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const resolveMs = durationMs(resolveStartedAt);
      const account = resolved.account.config;
      const secrets = resolved.secrets;
      let connectMs = 0;
      let lockMs = 0;
      let fetchMs = 0;
      let parseMs = 0;
      let attachMs = 0;
      let sourceBytes = 0;

      try {
        const response = await withImapReconnect(
          account,
          secrets,
          async (imap) => {
            connectMs = durationMs(requestStartedAt) - resolveMs;
            const lockStartedAt = performance.now();
            return await withMailboxLock(imap, folder, async () => {
              lockMs = durationMs(lockStartedAt);
              const fetchStartedAt = performance.now();
              const one = await withTimeout(
                imap.fetchOne(uid, {
                  uid: true,
                  envelope: true,
                  internalDate: true,
                  flags: true,
                  size: true,
                  source: true,
                }, { uid: true }),
                25_000,
                "fetch-message-source",
              );
              fetchMs = durationMs(fetchStartedAt);
              if (!one || !one.source) {
                throw new HttpError(STATUS.NotFound, "message not found");
              }
              sourceBytes = sourceByteLength(one.source);
              const parseStartedAt = performance.now();
              const parsed = await parseMailSourceInWorker(
                one.source,
                "message",
                10_000,
              ) as {
                text?: string;
                html?: unknown;
                attachments: Array<{
                  filename?: string;
                  contentType?: string;
                  size?: number;
                }>;
              };
              parseMs = durationMs(parseStartedAt);
              const textBody = parsed.text ?? "";
              const htmlBody = parsed.html ? String(parsed.html) : "";
              const ebpPayload = extractEbpPayload(textBody || htmlBody);
              const ebpBodyPayloadHash = ebpPayload
                ? hashPayload(ebpPayload)
                : null;
              const attachStartedAt = performance.now();
              const attachments = parsed.attachments.map((
                att,
                index: number,
              ) => ({
                filename: att.filename ?? "attachment",
                contentType: att.contentType ?? "application/octet-stream",
                size: att.size ?? 0,
                index,
                isEbpEncryptedAttachment:
                  (att.contentType ?? "application/octet-stream") ===
                    EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE,
              }));
              attachMs = durationMs(attachStartedAt);
              return json({
                accountId: resolved.account.id,
                uid: one.uid,
                subject: one.envelope?.subject ?? "(no subject)",
                from: getAddressText(one.envelope?.from),
                to: getAddressText(one.envelope?.to),
                date: one.internalDate
                  ? new Date(one.internalDate).getTime()
                  : null,
                size: typeof one.size === "number" ? one.size : null,
                text: textBody,
                html: htmlBody,
                attachments,
                ebpPayload,
                ebpBodyPayloadHash,
                _timing: {
                  resolveMs,
                  oauthMs: resolved.oauthRefreshMs,
                  connectMs,
                  lockMs,
                  fetchMs,
                  parseMs,
                  attachMs,
                  totalMs: durationMs(requestStartedAt),
                  sourceBytes,
                },
              });
            }, { lockTimeoutMs: 10_000 });
          },
          { connectTimeoutMs: 10_000 },
        );
        console.warn(
          `mail/message account=${resolved.account.id} folder=${folder} uid=${uid} resolveMs=${resolveMs} oauthMs=${
            resolved.oauthRefreshMs ?? 0
          } connectMs=${connectMs} lockMs=${lockMs} fetchMs=${fetchMs} parseMs=${parseMs} attachMs=${attachMs} totalMs=${
            durationMs(requestStartedAt)
          } bytes=${sourceBytes}`,
        );
        return response;
      } catch (err) {
        console.warn(
          `mail/message error account=${resolved.account.id} folder=${folder} uid=${uid} resolveMs=${resolveMs} oauthMs=${
            resolved.oauthRefreshMs ?? 0
          } connectMs=${connectMs} lockMs=${lockMs} fetchMs=${fetchMs} parseMs=${parseMs} attachMs=${attachMs} totalMs=${
            durationMs(requestStartedAt)
          } bytes=${sourceBytes} error=${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw err;
      }
    }

    if (
      req.method === "GET" && url.pathname === "/api/v1/mail/message/attachment"
    ) {
      const requestStartedAt = performance.now();
      const home = url.searchParams.get("home") ?? undefined;
      const accountId = toSafeString(url.searchParams.get("accountId"), 128) ||
        undefined;
      const folder =
        toSafeString(url.searchParams.get("folder") ?? "INBOX", 128) || "INBOX";
      const uidRaw = url.searchParams.get("uid");
      const indexRaw = url.searchParams.get("index");
      const uid = Number(uidRaw);
      const index = Number(indexRaw);
      if (!Number.isInteger(uid) || uid <= 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "uid must be a positive integer",
        );
      }
      if (!Number.isInteger(index) || index < 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "index must be a non-negative integer",
        );
      }
      const resolveStartedAt = performance.now();
      const ctx = await getContext(home ?? undefined);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const resolveMs = durationMs(resolveStartedAt);
      const account = resolved.account.config;
      const secrets = resolved.secrets;
      let fetchMs = 0;
      let parseMs = 0;
      let sourceBytes = 0;

      const response = await withImapReconnect(
        account,
        secrets,
        async (imap) => {
          return await withMailboxLock(imap, folder, async () => {
            const fetchStartedAt = performance.now();
            const one = await withTimeout(
              imap.fetchOne(uid, {
                uid: true,
                source: true,
              }, { uid: true }),
              25_000,
              "fetch-attachment-source",
            );
            fetchMs = durationMs(fetchStartedAt);
            if (!one || !one.source) {
              throw new HttpError(STATUS.NotFound, "message not found");
            }
            sourceBytes = sourceByteLength(one.source);
            const parseStartedAt = performance.now();
            const parsed = await parseMailSourceInWorker(
              one.source,
              "attachment",
              10_000,
            ) as {
              attachments: Array<{
                filename?: string;
                contentType?: string;
                size?: number;
                content?: unknown;
              }>;
            };
            parseMs = durationMs(parseStartedAt);
            const attachment = parsed.attachments[index];
            if (!attachment) {
              throw new HttpError(STATUS.NotFound, "attachment not found");
            }
            const contentType = attachment.contentType ??
              "application/octet-stream";
            if (contentType !== EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE) {
              throw new HttpError(
                STATUS.BadRequest,
                "attachment is not an EBP encrypted attachment",
              );
            }
            let raw = "";
            if (typeof attachment.content === "string") {
              raw = attachment.content;
            } else if (attachment.content instanceof Uint8Array) {
              raw = new TextDecoder().decode(attachment.content);
            }
            if (!raw) {
              throw new HttpError(
                STATUS.BadRequest,
                "attachment payload is empty",
              );
            }
            const payload = parseEncryptedEmailAttachmentPayload(
              JSON.parse(raw),
            );
            return json({
              accountId: resolved.account.id,
              uid,
              index,
              filename: attachment.filename ?? "attachment",
              contentType,
              size: attachment.size ?? 0,
              attachmentId: payload.attachmentId,
              ebpPayload: payload,
              _timing: {
                resolveMs,
                oauthMs: resolved.oauthRefreshMs,
                fetchMs,
                parseMs,
                totalMs: durationMs(requestStartedAt),
                sourceBytes,
              },
            });
          }, { lockTimeoutMs: 10_000 });
        },
        { connectTimeoutMs: 10_000 },
      );
      console.warn(
        `mail/message/attachment account=${resolved.account.id} folder=${folder} uid=${uid} index=${index} resolveMs=${resolveMs} oauthMs=${
          resolved.oauthRefreshMs ?? 0
        } fetchMs=${fetchMs} parseMs=${parseMs} totalMs=${
          durationMs(requestStartedAt)
        } bytes=${sourceBytes}`,
      );
      return response;
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/send") {
      const body = await readJson<{
        home?: unknown;
        accountId?: unknown;
        to?: unknown;
        subject?: unknown;
        text?: unknown;
        html?: unknown;
        attachments?: unknown;
      }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const accountId = toSafeString(body.accountId, 128) || undefined;
      const to = toSafeString(body.to, 512);
      const subject = toSafeString(body.subject, 512);
      const text = typeof body.text === "string" ? body.text : "";
      const htmlText = typeof body.html === "string" ? body.html : "";
      const attachmentsInput = parseMailAttachmentInputs(body.attachments);
      if (!to || !subject) {
        throw new HttpError(STATUS.BadRequest, "to and subject are required");
      }
      if (!text && !htmlText && attachmentsInput.length === 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "text, html, or attachments are required",
        );
      }
      const ctx = await getContext(home ?? undefined);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const account = resolved.account.config;
      const secrets = resolved.secrets;
      const transport = nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: buildSmtpAuth(account, secrets),
      });
      const from = account.fromName
        ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
        : account.fromEmail;
      const info = await transport.sendMail({
        from,
        to,
        subject,
        text: text || undefined,
        html: htmlText || undefined,
        attachments: attachmentsInput.map((attachment) => ({
          filename: attachment.fileName,
          contentType: attachment.mimeType,
          content: attachment.fileBytes,
        })),
      });
      return json({
        ok: true,
        accountId: resolved.account.id,
        messageId: info.messageId ?? null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/send-ebp") {
      const body = await readJson<{
        home?: unknown;
        accountId?: unknown;
        identity?: unknown;
        to?: unknown;
        subject?: unknown;
        message?: unknown;
        recipient?: unknown;
        recipients?: unknown;
        password?: unknown;
        includePublicKeys?: unknown;
        attachments?: unknown;
      }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const accountId = toSafeString(body.accountId, 128) || undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const to = toSafeString(body.to, 512);
      const subject = toSafeString(body.subject, 512);
      const message = typeof body.message === "string" ? body.message : "";
      const recipient = typeof body.recipient === "string"
        ? body.recipient
        : undefined;
      const recipientsInput = parseMailRecipientsInput(body.recipients);
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const includePublicKeys = Boolean(body.includePublicKeys);
      const attachmentsInput = parseMailAttachmentInputs(body.attachments);
      const resolvedRecipients = recipientsInput.length
        ? recipientsInput
        : (recipient && to ? [{ contact: recipient, email: to }] : []);
      if (!subject) {
        throw new HttpError(STATUS.BadRequest, "subject is required");
      }
      if (!resolvedRecipients.length) {
        throw new HttpError(
          STATUS.BadRequest,
          "at least one recipient is required",
        );
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }
      if (!message && attachmentsInput.length === 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "message or attachments are required",
        );
      }

      const ctx = await getContext(home ?? undefined, identityName);
      const identity = await loadIdentity(ctx, password);
      const resolved = await resolveMailAccount(ctx.identityDir, accountId);
      const account = resolved.account.config;
      const secrets = resolved.secrets;
      const recipients = await Promise.all(
        resolvedRecipients.map(async (item) => ({
          email: item.email,
          contact: await loadContact(ctx, item.contact),
        })),
      );
      const toHeader = recipients.map((item) => item.email).join(", ");

      const summary = identity.summary;
      const senderIdentity = includePublicKeys
        ? {
          fingerprint: summary.fingerprint,
          signingKeyType: summary.signingKeyType,
          encryptionKeyType: summary.encryptionKeyType,
          signingKey: summary.signingKey,
          encryptionKey: summary.encryptionKey,
          signingKeyDetails: summary.signingKeyDetails,
          encryptionKeyDetails: summary.encryptionKeyDetails,
        }
        : undefined;
      let bodyPayload: Record<string, unknown>;
      let encryptedAttachments: Array<Record<string, unknown>> = [];
      if (recipients.length === 1 && recipientsInput.length === 0) {
        const [single] = recipients;
        const bodyCiphertext = identity.signAndEncryptFor(
          message,
          single.contact,
        );
        bodyPayload = buildEncryptedSignedMessagePayload({
          recipientFingerprint: single.contact.fingerprint,
          senderFingerprint: identity.toFingerprint(),
          ciphertext: bodyCiphertext,
          senderIdentity,
        });
        const bodyPayloadHash = hashPayload(bodyPayload);
        encryptedAttachments = attachmentsInput.map((attachment) => {
          const attachmentId = randomHex(12);
          const envelope = createEmailAttachmentCleartextEnvelope({
            attachmentId,
            fileBytes: attachment.fileBytes,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            bodyPayloadHash,
          });
          const ciphertext = identity.signAndEncryptFor(
            JSON.stringify(envelope),
            single.contact,
          );
          return {
            type: "ebp-encrypted-signed-email-attachment" as const,
            version: FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachment,
            recipientFingerprint: single.contact.fingerprint,
            senderFingerprint: identity.toFingerprint(),
            attachmentId,
            ciphertext,
          };
        });
      } else {
        const contacts = recipients.map((entry) => entry.contact);
        const provisional = identity.signAndEncryptForMany(message, contacts, {
          attachmentManifest: [],
        });
        const contentKey = hexToBytes(provisional.contentKey);
        const encryptedAttachmentsMulti = attachmentsInput.map((attachment) => {
          const attachmentId = randomHex(12);
          const envelope = createEmailAttachmentCleartextEnvelope({
            attachmentId,
            fileBytes: attachment.fileBytes,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
          });
          const encrypted = MultiRecipientCipher.encryptWithContentKey(
            new TextEncoder().encode(JSON.stringify(envelope)),
            contentKey,
          );
          return {
            type: "ebp-encrypted-signed-email-attachment-multi" as const,
            version: FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachmentMulti,
            senderFingerprint: identity.toFingerprint(),
            attachmentId,
            contentNonce: encrypted.contentNonce,
            ciphertext: encrypted.ciphertext,
          };
        });
        const attachmentManifest: MultiRecipientAttachmentManifestEntry[] =
          encryptedAttachmentsMulti.map((item) => ({
            attachmentId: item.attachmentId,
            ciphertextSha256: sha256Hex(item.ciphertext),
          }));
        const bodyEncrypted = identity.signAndEncryptForMany(
          message,
          contacts,
          {
            attachmentManifest,
            contentKeyHex: provisional.contentKey,
          },
        );
        bodyPayload = buildEncryptedSignedMessageMultiPayload({
          senderFingerprint: identity.toFingerprint(),
          recipients: bodyEncrypted.recipients,
          contentNonce: bodyEncrypted.contentNonce,
          ciphertext: bodyEncrypted.ciphertext,
          senderIdentity,
        });
        encryptedAttachments = encryptedAttachmentsMulti;
      }
      const armoredBody = [
        "-----BEGIN EBP MESSAGE-----",
        JSON.stringify(bodyPayload, null, 2),
        "-----END EBP MESSAGE-----",
      ].join("\n");

      const transport = nodemailer.createTransport({
        host: account.smtpHost,
        port: account.smtpPort,
        secure: account.smtpSecure,
        auth: buildSmtpAuth(account, secrets),
      });
      const from = account.fromName
        ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
        : account.fromEmail;
      const info = await transport.sendMail({
        from,
        to: toHeader,
        subject,
        text: armoredBody,
        attachments: encryptedAttachments.map((attachment, idx) => ({
          filename: `ebp-attachment-${idx + 1}.json`,
          contentType: EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE,
          content: JSON.stringify(attachment, null, 2),
        })),
      });
      return json({
        ok: true,
        accountId: resolved.account.id,
        messageId: info.messageId ?? null,
        attachmentCount: encryptedAttachments.length,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/identities") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const names = await listIdentityNames(ctx.identityDir);
      const currentState = await readState(ctx.identityDir);
      const server = currentState?.server ?? null;

      const identitiesWithFingerprints = await Promise.all(
        names.map(async (name) => {
          const identityCtx = await getContext(home ?? undefined, name);
          const publicData = await loadIdentityPublic(identityCtx);
          const fingerprint = publicData?.fingerprint ?? null;

          let publishedToServer = false;
          if (fingerprint && server) {
            try {
              const res = await fetch(
                apiUrl(server, `/api/v1/identity/${fingerprint}`),
              );
              publishedToServer = res.ok;
            } catch {
              // Server unreachable, assume not published
            }
          }

          return {
            name,
            fingerprint,
            publishedToServer,
          };
        }),
      );

      return json({
        identities: identitiesWithFingerprints,
        currentIdentity: currentState?.currentIdentity ?? ctx.currentIdentity,
      });
    }

    // Get public info for current identity (no password required)
    if (req.method === "GET" && url.pathname === "/api/v1/identity/public") {
      const home = url.searchParams.get("home") ?? undefined;
      const identityName = url.searchParams.get("identity") ?? undefined;
      const ctx = await getContext(home ?? undefined, identityName);
      const publicData = await loadIdentityPublic(ctx);
      if (!publicData) {
        return json({ available: false });
      }
      // Convert details from {path: [detail, proof]} to [{path, detail}]
      const detailsArray = Object.entries(publicData.details ?? {}).map((
        [path, val],
      ) => ({
        path,
        detail: Array.isArray(val) ? val[0] : val,
      }));
      // Get revoked details
      const revokedDetailPaths = Object.keys(publicData.revokedDetails ?? {});
      return json({
        available: true,
        fingerprint: publicData.fingerprint,
        signingKeyType: publicData.signingKeyType,
        encryptionKeyType: publicData.encryptionKeyType,
        signingKeyDetails: publicData.signingKeyDetails,
        encryptionKeyDetails: publicData.encryptionKeyDetails,
        details: detailsArray,
        revoked: !!publicData.revocationCertificate,
        revokedDetails: revokedDetailPaths,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/identity/generate") {
      const body = await readJson<{
        name?: unknown;
        signingType?: unknown;
        encryptionType?: unknown;
        password?: unknown;
        force?: unknown;
        home?: unknown;
      }>(req);

      const name = typeof body.name === "string" && body.name.length > 0
        ? body.name
        : undefined;
      const signingType = typeof body.signingType === "string"
        ? body.signingType
        : "dilithium";
      const encryptionType = typeof body.encryptionType === "string"
        ? body.encryptionType
        : "kyber";
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const force = Boolean(body.force);
      const home = typeof body.home === "string" ? body.home : undefined;

      const ctx = await getContext(home, name);

      if (!password || password.length < 8) {
        throw new HttpError(
          STATUS.BadRequest,
          "password required and must be at least 8 characters",
        );
      }

      if (!["dilithium", "sphincs"].includes(signingType)) {
        throw new HttpError(
          STATUS.BadRequest,
          "invalid signing type (dilithium|sphincs)",
        );
      }
      if (encryptionType !== "kyber") {
        throw new HttpError(
          STATUS.BadRequest,
          "invalid encryption type (only kyber supported)",
        );
      }

      try {
        await Deno.stat(ctx.identityPath);
        if (!force) {
          throw new HttpError(
            STATUS.Conflict,
            "identity already exists; pass force to overwrite",
          );
        }
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }

      const identity = new Identity(
        signingType as "dilithium" | "sphincs",
        encryptionType as "kyber",
      );

      await ensurePrivateDir(ctx.identityDir);
      await ensurePrivateDir(ctx.contactsDir);
      await saveIdentity(ctx, password, identity);
      await updateState(ctx.identityDir, {
        currentIdentity: ctx.currentIdentity,
      });

      return json({
        ok: true,
        identity: {
          name: ctx.currentIdentity,
          fingerprint: identity.toFingerprint(),
          signingKeyType: identity.signingKeyType,
          encryptionKeyType: identity.encryptionKeyType,
          identityPath: ctx.identityPath,
        },
      }, STATUS.Created);
    }

    if (req.method === "POST" && url.pathname === "/api/v1/identity/use") {
      const body = await readJson<{ name?: unknown; home?: unknown }>(req);
      const name = typeof body.name === "string" ? body.name : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      if (!name) throw new HttpError(STATUS.BadRequest, "name is required");

      const ctx = await getContext(home, name);
      try {
        await Deno.stat(ctx.identityPath);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          throw new HttpError(STATUS.NotFound, "identity not found");
        }
        throw e;
      }

      await updateState(ctx.identityDir, { currentIdentity: name });
      return json({ ok: true, currentIdentity: name });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/identity/info") {
      const body = await readJson<
        { password?: unknown; home?: unknown; identity?: unknown }
      >(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      return json({
        fingerprint: identity.toFingerprint(),
        signingKeyType: identity.signingKeyType,
        encryptionKeyType: identity.encryptionKeyType,
        details: Array.from(identity.details.entries()).map((
          [path, [detail]],
        ) => ({ path, detail })),
      });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/identity/export-public"
    ) {
      const body = await readJson<
        { password?: unknown; home?: unknown; identity?: unknown }
      >(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      return json(identity.summary);
    }

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
      await ensurePrivateDir(ctx.contactsDir);
      const contactName = name ?? contact.fingerprint.substring(0, 16);
      const contactPath = `${ctx.contactsDir}/${contactName}.json`;
      try {
        const existingRaw = await Deno.readTextFile(contactPath);
        const existing = JSON.parse(existingRaw) as Record<string, unknown>;
        const localFields = [
          "localAlias",
          "localDescription",
          "localEmail",
        ] as const;
        for (const key of localFields) {
          if (typeof existing[key] === "string" && existing[key]) {
            (contact as Record<string, unknown>)[key] = existing[key];
          }
        }
      } catch {
        // no existing file to preserve from
      }
      await Deno.writeTextFile(contactPath, JSON.stringify(contact, null, 2), {
        mode: 0o600,
      });

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
      const found = await findContactRecord(ctx, fingerprint);
      if (!found) throw new HttpError(STATUS.NotFound, "contact not found");

      const detailEntry = found.contact.details?.[path];
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

      found.contact.resolvedOpaqueDetails = {
        ...(found.contact.resolvedOpaqueDetails ?? {}),
        [path]: value,
      };
      await Deno.writeTextFile(
        found.path,
        JSON.stringify(found.contact, null, 2),
        { mode: 0o600 },
      );
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
      const found = await findContactRecord(ctx, fingerprint);
      if (!found) throw new HttpError(STATUS.NotFound, "contact not found");

      const raw = found.contact as Record<string, unknown>;
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
      await Deno.writeTextFile(
        found.path,
        JSON.stringify(found.contact, null, 2),
        { mode: 0o600 },
      );
      return json({ ok: true, fingerprint });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/create") {
      const body = await readJson<{
        masterFingerprint?: unknown;
        childFingerprint?: unknown;
        expiry?: unknown;
        context?: unknown;
      }>(req);
      const masterFingerprint = typeof body.masterFingerprint === "string"
        ? body.masterFingerprint
        : "";
      const childFingerprint = typeof body.childFingerprint === "string"
        ? body.childFingerprint
        : "";
      const expiry = typeof body.expiry === "number" ? body.expiry : 0;
      const context = typeof body.context === "string" ? body.context : "";
      if (!masterFingerprint || !childFingerprint) {
        throw new HttpError(
          STATUS.BadRequest,
          "masterFingerprint and childFingerprint are required",
        );
      }
      if (
        !isValidFingerprintBech32(masterFingerprint) ||
        !isValidFingerprintBech32(childFingerprint)
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "fingerprints must be valid bech32",
        );
      }
      const cert = createHierarchyCertificate(
        masterFingerprint,
        childFingerprint,
        { expiry, context },
      );
      return json({
        certificate: stringToHex(JSON.stringify(cert)),
        complete: false,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/propose") {
      const body = await readJson<{
        masterFingerprint?: unknown;
        childFingerprint?: unknown;
        expiry?: unknown;
        context?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        server?: unknown;
      }>(req);
      const masterFingerprint = typeof body.masterFingerprint === "string"
        ? body.masterFingerprint
        : "";
      const childFingerprint = typeof body.childFingerprint === "string"
        ? body.childFingerprint
        : "";
      const expiry = typeof body.expiry === "number" ? body.expiry : 0;
      const context = typeof body.context === "string" ? body.context : "";
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!masterFingerprint || !childFingerprint) {
        throw new HttpError(
          STATUS.BadRequest,
          "masterFingerprint and childFingerprint are required",
        );
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }
      if (
        !isValidFingerprintBech32(masterFingerprint) ||
        !isValidFingerprintBech32(childFingerprint)
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "fingerprints must be valid bech32",
        );
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      const proposerFingerprint = identity.toFingerprint();
      if (
        proposerFingerprint !== masterFingerprint &&
        proposerFingerprint !== childFingerprint
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "current identity must be either master or child",
        );
      }
      const cert = createHierarchyCertificate(
        masterFingerprint,
        childFingerprint,
        { expiry, context },
      );
      const payload = getHierarchySignaturePayload(cert);
      const signature = identity.signMessage(payload, undefined, "hierarchy");
      if (proposerFingerprint === masterFingerprint) {
        cert.masterSignature = signature;
      } else {
        cert.childSignature = signature;
      }
      const encoded = stringToHex(JSON.stringify(cert));

      const proposal = await addPendingHierarchyLocal(ctx, {
        masterFingerprint,
        childFingerprint,
        proposerFingerprint,
        certificate: encoded,
        context,
        expiry,
      });
      try {
        const server = resolveServer(ctx, serverOverride);
        const res = await fetch(apiUrl(server, "/api/v1/hierarchy/propose"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            proposerFingerprint,
            certificate: encoded,
          }),
        });
        if (!res.ok && res.status !== STATUS.NotFound) {
          const responseBody = await res.json().catch(() => ({})) as {
            error?: string;
          };
          throw new HttpError(
            STATUS.BadGateway,
            `failed to propose hierarchy certificate: ${
              responseBody.error ?? `HTTP ${res.status}`
            }`,
          );
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        // Offline/temporary server issues should not block proposal creation in local queue.
      }
      return json({ ok: true, certificate: encoded, proposal });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/list") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const entries = await listHierarchyCertificatesLocal(ctx);
      return json({
        relationships: entries.map((entry) => ({
          masterFingerprint: entry.decoded.masterFingerprint,
          childFingerprint: entry.decoded.childFingerprint,
          timestamp: entry.decoded.timestamp,
          expiry: entry.decoded.expiry,
          context: entry.decoded.context,
          certificate: entry.certificate,
          expired: isHierarchyCertificateExpired({
            expiry: entry.decoded.expiry,
          }),
        })),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/tree") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const pub = await loadIdentityPublic(ctx);
      const selfFingerprint = pub?.fingerprint ?? null;
      const entries = await listHierarchyCertificatesLocal(ctx);
      const certs = entries.map((e) => e.decoded);

      const allFingerprints = new Set<string>();
      if (selfFingerprint) allFingerprints.add(selfFingerprint);
      for (const cert of certs) {
        allFingerprints.add(cert.masterFingerprint);
        allFingerprints.add(cert.childFingerprint);
      }

      const contacts = await listContacts(ctx);
      const contactByFingerprint = new Map<
        string,
        { name: string; details: Record<string, [string, string]> }
      >();
      for (const c of contacts) {
        if (c.contact.fingerprint) {
          contactByFingerprint.set(c.contact.fingerprint, {
            name: c.name,
            details: c.contact.details ?? {},
          });
        }
      }

      const selfDetails: Record<string, string> = {};
      if (pub) {
        for (const [path, val] of Object.entries(pub.details ?? {})) {
          selfDetails[path] = Array.isArray(val) ? val[0] : String(val);
        }
      }

      const nodes: Array<{
        fingerprint: string;
        label: string;
        details: Record<string, string>;
        color: string;
        isSelf: boolean;
      }> = [];
      for (const fp of allFingerprints) {
        const isSelf = fp === selfFingerprint;
        let label = fp.substring(0, 16) + "…";
        const details: Record<string, string> = {};
        if (isSelf && pub) {
          for (const [k, v] of Object.entries(selfDetails)) {
            details[k] = v;
          }
          if (selfDetails["name"]) label = selfDetails["name"];
        } else {
          const contact = contactByFingerprint.get(fp);
          if (contact) {
            label = contact.name;
            for (const [k, val] of Object.entries(contact.details)) {
              details[k] = Array.isArray(val) ? val[0] : String(val);
            }
          }
        }
        nodes.push({
          fingerprint: fp,
          label,
          details,
          color: fingerprintColor(fp),
          isSelf,
        });
      }

      const relationships = certs.map((cert) => ({
        masterFingerprint: cert.masterFingerprint,
        childFingerprint: cert.childFingerprint,
        context: cert.context,
        timestamp: cert.timestamp,
        expiry: cert.expiry,
        expired: isHierarchyCertificateExpired({ expiry: cert.expiry }),
      }));

      const childToParent = new Map<string, string>();
      for (const cert of certs) {
        childToParent.set(cert.childFingerprint, cert.masterFingerprint);
      }
      const roots: string[] = [];
      for (const fp of allFingerprints) {
        if (!childToParent.has(fp)) {
          roots.push(fp);
        }
      }

      return json({
        focusFingerprint: selfFingerprint,
        nodes,
        relationships,
        roots,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/pending") {
      const home = url.searchParams.get("home") ?? undefined;
      const identityName = url.searchParams.get("identity") ?? undefined;
      const serverOverride = url.searchParams.get("server") ?? undefined;
      const ctx = await getContext(
        home ?? undefined,
        identityName ?? undefined,
      );
      const pub = await loadIdentityPublic(ctx);
      if (!pub?.fingerprint) {
        throw new HttpError(
          STATUS.BadRequest,
          "current identity fingerprint unavailable",
        );
      }
      const local = await readPendingHierarchyLocal(ctx);
      const proposals = local
        .filter((p) =>
          (p.masterFingerprint === pub.fingerprint ||
            p.childFingerprint === pub.fingerprint) &&
          p.proposerFingerprint !== pub.fingerprint
        )
        .map((p) => ({
          id: p.id,
          masterFingerprint: p.masterFingerprint,
          childFingerprint: p.childFingerprint,
          proposerFingerprint: p.proposerFingerprint,
          certificate: p.certificate,
          context: p.context,
          expiry: p.expiry,
          createdAt: p.createdAt,
        }));
      return json({ fingerprint: pub.fingerprint, proposals });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/accept") {
      const body = await readJson<{
        proposalId?: unknown;
        certificate?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        server?: unknown;
      }>(req);
      const proposalId = Number(body.proposalId);
      const certificate = typeof body.certificate === "string"
        ? body.certificate
        : "";
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!Number.isInteger(proposalId) || proposalId <= 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "proposalId must be a positive integer",
        );
      }
      if (!certificate) {
        throw new HttpError(STATUS.BadRequest, "certificate is required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      const cert = decodeHierarchyCertificateDraft(certificate);
      const myFingerprint = identity.toFingerprint();
      if (
        myFingerprint !== cert.masterFingerprint &&
        myFingerprint !== cert.childFingerprint
      ) {
        throw new HttpError(
          STATUS.BadRequest,
          "current identity is not part of this certificate",
        );
      }
      const payload = getHierarchySignaturePayload(cert);
      const signature = identity.signMessage(payload, undefined, "hierarchy");
      if (myFingerprint === cert.masterFingerprint) {
        cert.masterSignature = signature;
      }
      if (myFingerprint === cert.childFingerprint) {
        cert.childSignature = signature;
      }
      const signed = stringToHex(JSON.stringify(cert));
      if (!decodeHierarchyCertificate(signed)) {
        throw new HttpError(
          STATUS.BadRequest,
          "accepted certificate must include both signatures",
        );
      }

      const local = await readPendingHierarchyLocal(ctx);
      const proposal = local.find((p) => p.id === proposalId);
      if (!proposal) {
        throw new HttpError(STATUS.NotFound, "pending proposal not found");
      }
      if (proposal.proposerFingerprint === myFingerprint) {
        throw new HttpError(
          STATUS.Forbidden,
          "proposer cannot accept their own pending entry",
        );
      }
      const server = resolveServer(ctx, serverOverride);
      const publishRes = await fetch(apiUrl(server, "/api/v1/hierarchy"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate: signed }),
      });
      const publishBody = await publishRes.json().catch(() => ({})) as {
        error?: string;
      };
      if (!publishRes.ok) {
        throw new HttpError(
          STATUS.BadGateway,
          `failed to publish accepted hierarchy certificate: ${
            publishBody.error ?? `HTTP ${publishRes.status}`
          }`,
        );
      }
      await writePendingHierarchyLocal(
        ctx,
        local.filter((p) => p.id !== proposalId),
      );
      await storeHierarchyCertificateLocal(ctx, signed);
      return json({ ok: true, certificate: signed });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/reject") {
      const body = await readJson<{
        proposalId?: unknown;
        home?: unknown;
        identity?: unknown;
        server?: unknown;
        password?: unknown;
      }>(req);
      const proposalId = Number(body.proposalId);
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      if (!Number.isInteger(proposalId) || proposalId <= 0) {
        throw new HttpError(
          STATUS.BadRequest,
          "proposalId must be a positive integer",
        );
      }
      const ctx = await getContext(home, identityName);
      const pub = await loadIdentityPublic(ctx);
      if (!pub?.fingerprint) {
        throw new HttpError(
          STATUS.BadRequest,
          "current identity fingerprint unavailable",
        );
      }
      const local = await readPendingHierarchyLocal(ctx);
      const proposal = local.find((p) => p.id === proposalId);
      if (!proposal) {
        throw new HttpError(STATUS.NotFound, "pending proposal not found");
      }
      if (proposal.proposerFingerprint === pub.fingerprint) {
        throw new HttpError(
          STATUS.Forbidden,
          "proposer cannot reject their own pending entry",
        );
      }
      await writePendingHierarchyLocal(
        ctx,
        local.filter((p) => p.id !== proposalId),
      );
      if (serverOverride || ctx.server) {
        // F-SERVER-02: the server now requires a signature over
        // {action, fingerprint, proposalId, timestamp} from the
        // rejecting identity's signing key.
        if (!password) {
          throw new HttpError(
            STATUS.BadRequest,
            "password is required to sign the reject request for the server",
          );
        }
        try {
          const server = resolveServer(ctx, serverOverride);
          const identity = await loadIdentity(ctx, password);
          const timestamp = Date.now();
          const rejectMessage = stableStringify({
            action: "hierarchy::reject",
            fingerprint: pub.fingerprint,
            proposalId,
            timestamp,
          });
          const signature = identity.signMessage(rejectMessage);
          await fetch(apiUrl(server, "/api/v1/hierarchy/reject"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              proposalId,
              fingerprint: pub.fingerprint,
              timestamp,
              signature,
            }),
          });
        } catch (err) {
          // propagate password errors, ignore network errors
          if (err instanceof HttpError) throw err;
          // ignore optional remote reject sync failures
        }
      }
      return json({ ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/publish") {
      const body = await readJson<
        { certificate?: unknown; home?: unknown; server?: unknown }
      >(req);
      const certificate = typeof body.certificate === "string"
        ? body.certificate
        : "";
      const home = typeof body.home === "string" ? body.home : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!certificate) {
        throw new HttpError(STATUS.BadRequest, "certificate is required");
      }
      if (!decodeHierarchyCertificate(certificate)) {
        throw new HttpError(
          STATUS.BadRequest,
          "certificate must include both signatures",
        );
      }
      const ctx = await getContext(home);
      const server = resolveServer(ctx, serverOverride);
      const res = await fetch(apiUrl(server, "/api/v1/hierarchy"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ certificate }),
      });
      const responseBody = await res.json().catch(() => ({})) as {
        error?: string;
      };
      if (!res.ok) {
        throw new HttpError(
          STATUS.BadGateway,
          `failed to publish hierarchy certificate: ${
            responseBody.error ?? `HTTP ${res.status}`
          }`,
        );
      }
      return json({ ok: true });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/hierarchy/")) {
      const fingerprint = decodeURIComponent(
        url.pathname.replace("/api/v1/hierarchy/", ""),
      );
      if (!fingerprint) {
        throw new HttpError(STATUS.BadRequest, "fingerprint is required");
      }
      if (!isValidFingerprintBech32(fingerprint)) {
        throw new HttpError(
          STATUS.BadRequest,
          "fingerprint must be valid bech32",
        );
      }

      const home = url.searchParams.get("home") ?? undefined;
      const serverOverride = url.searchParams.get("server") ?? undefined;
      const source = url.searchParams.get("source") ?? "local";
      const ctx = await getContext(home ?? undefined);

      let treeData: {
        fingerprint: string;
        root: string;
        ancestors: string[];
        descendants: string[];
        allFingerprints: string[];
        relationships: Array<{
          masterFingerprint: string;
          childFingerprint: string;
          timestamp: number;
          expiry: number;
          context: string;
          certificate: string;
          expired: boolean;
        }>;
      };

      if (source === "server") {
        const server = resolveServer(ctx, serverOverride ?? undefined);
        const res = await fetch(
          apiUrl(server, `/api/v1/hierarchy/${fingerprint}`),
        );
        const bodyJson = await res.json().catch(() => ({})) as Record<
          string,
          unknown
        >;
        if (!res.ok) {
          throw new HttpError(
            STATUS.BadGateway,
            `failed to fetch hierarchy: ${
              (bodyJson as { error?: string }).error ?? `HTTP ${res.status}`
            }`,
          );
        }
        treeData = bodyJson as typeof treeData;
      } else {
        const certs = await listHierarchyCertificatesLocal(ctx);
        treeData = buildHierarchyTreeFromCertificates(
          fingerprint,
          certs.map((entry) => entry.decoded),
        );
      }

      const pub = await loadIdentityPublic(ctx);
      const selfFingerprint = pub?.fingerprint ?? null;

      const contacts = await listContacts(ctx);
      const contactByFp = new Map<
        string,
        { name: string; details: Record<string, [string, string]> }
      >();
      for (const c of contacts) {
        if (c.contact.fingerprint) {
          contactByFp.set(c.contact.fingerprint, {
            name: c.name,
            details: (c.contact.details ?? {}) as Record<
              string,
              [string, string]
            >,
          });
        }
      }

      const selfDetails: Record<string, string> = {};
      if (pub) {
        for (const [p, val] of Object.entries(pub.details ?? {})) {
          selfDetails[p] = Array.isArray(val) ? val[0] : String(val);
        }
      }

      const nodes: Array<{
        fingerprint: string;
        label: string;
        details: Record<string, string>;
        color: string;
        isSelf: boolean;
        isFocus: boolean;
      }> = [];

      for (const fp of treeData.allFingerprints) {
        const isSelf = fp === selfFingerprint;
        const isFocus = fp === fingerprint;
        let label = fp.substring(0, 16) + "…";
        const details: Record<string, string> = {};
        if (isSelf && pub) {
          for (const [k, v] of Object.entries(selfDetails)) {
            details[k] = v;
          }
          if (selfDetails["name"]) label = selfDetails["name"];
        } else {
          const contact = contactByFp.get(fp);
          if (contact) {
            label = contact.name;
            for (const [k, val] of Object.entries(contact.details)) {
              details[k] = Array.isArray(val) ? val[0] : String(val);
            }
          }
        }
        nodes.push({
          fingerprint: fp,
          label,
          details,
          color: fingerprintColor(fp),
          isSelf,
          isFocus,
        });
      }

      const childSet = new Set(
        treeData.relationships.map((r) => r.childFingerprint),
      );
      const roots: string[] = [];
      for (const fp of treeData.allFingerprints) {
        if (!childSet.has(fp)) roots.push(fp);
      }

      return json({
        ...treeData,
        focusFingerprint: fingerprint,
        nodes,
        roots,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/sign") {
      const body = await readJson<{
        message?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        detached?: unknown;
        includeIdentity?: unknown;
        includeSalt?: unknown;
        salt?: unknown;
        signConfirmation?: unknown;
      }>(req);
      const message = typeof body.message === "string"
        ? body.message
        : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const detached = Boolean(body.detached);
      const includeIdentity = Boolean(body.includeIdentity);
      const includeSalt = body.includeSalt === undefined
        ? true
        : Boolean(body.includeSalt);
      const providedSalt = typeof body.salt === "string"
        ? body.salt
        : undefined;
      const signConfirmation = body.signConfirmation as
        | Record<string, unknown>
        | undefined;
      if (!message) {
        throw new HttpError(STATUS.BadRequest, "message is required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }
      if (
        (Deno.env.get("GUI_SIGN_CONFIRM_BYPASS") ?? "false").toLowerCase() !==
          "true"
      ) {
        const approved = signConfirmation?.approved === true;
        const approvedAt = typeof signConfirmation?.approvedAt === "number"
          ? signConfirmation.approvedAt
          : NaN;
        const confirmedMessageHash =
          typeof signConfirmation?.messageHash === "string"
            ? signConfirmation.messageHash
            : "";
        const expectedHash = sha256Hex(message);
        const stale = !Number.isFinite(approvedAt) ||
          Math.abs(Date.now() - approvedAt) > 60_000;
        if (!approved || stale || confirmedMessageHash !== expectedHash) {
          throw new HttpError(
            STATUS.BadRequest,
            "sign confirmation required (approve the exact message immediately before signing)",
          );
        }
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      const salt = providedSalt ?? (includeSalt ? randomHex(16) : "");
      const signature = (identity as Identity & {
        signMessage: (
          value: string,
          optionalSalt?: string,
          purpose?: "message",
        ) => string;
      })
        .signMessage(message, salt, "message");
      const messageHash = sha256Hex(message);
      const summary = identity.summary;
      const identityPayload = includeIdentity
        ? {
          fingerprint: summary.fingerprint,
          signingKeyType: summary.signingKeyType,
          encryptionKeyType: summary.encryptionKeyType,
          signingKey: summary.signingKey,
          encryptionKey: summary.encryptionKey,
          signingKeyDetails: summary.signingKeyDetails,
          encryptionKeyDetails: summary.encryptionKeyDetails,
        }
        : undefined;
      if (detached) {
        return json(buildDetachedSignaturePayload({
          fingerprint: identity.toFingerprint(),
          messageHash,
          salt,
          signature,
          identity: identityPayload,
        }));
      }
      return json(buildSignedMessagePayload({
        fingerprint: identity.toFingerprint(),
        message,
        messageHash,
        salt,
        signature,
        identity: identityPayload,
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/verify") {
      const body = await readJson<{
        payload?: unknown;
        message?: unknown;
        signature?: unknown;
        sender?: unknown;
        home?: unknown;
        publicIdentity?: unknown;
        salt?: unknown;
      }>(req);
      const payload = body.payload;
      const messageOverride = typeof body.message === "string"
        ? body.message
        : undefined;
      const signatureOverride = typeof body.signature === "string"
        ? body.signature
        : undefined;
      const sender = typeof body.sender === "string" ? body.sender : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const publicIdentity = body.publicIdentity;
      if (!payload) {
        throw new HttpError(STATUS.BadRequest, "payload is required");
      }

      const ctx = await getContext(home);
      let message: string;
      let signature: string;
      let fingerprint: string;
      let messageHash: string;
      let salt = "";

      if (typeof payload === "object" && payload && "type" in payload) {
        const obj = payload as Record<string, unknown>;
        if (obj.type === "ebp-signed-message") {
          message = String(obj.message ?? "");
          messageHash = String(obj.messageHash ?? "");
          salt = String(obj.salt ?? "");
          signature = String(obj.signature ?? "");
          fingerprint = String(obj.fingerprint ?? "");
          if (!message || !signature || !messageHash) {
            throw new HttpError(
              STATUS.BadRequest,
              "signed message payload missing required fields",
            );
          }
          if (sha256Hex(message) !== messageHash) {
            throw new HttpError(STATUS.BadRequest, "message hash mismatch");
          }
        } else if (obj.type === "ebp-signature") {
          if (!messageOverride) {
            throw new HttpError(
              STATUS.BadRequest,
              "message is required for detached signatures",
            );
          }
          message = messageOverride;
          messageHash = String(obj.messageHash ?? "");
          salt = String(obj.salt ?? "");
          signature = String(obj.signature ?? "");
          fingerprint = String(obj.fingerprint ?? "");
          if (!signature || !messageHash) {
            throw new HttpError(
              STATUS.BadRequest,
              "detached signature payload missing required fields",
            );
          }
          if (sha256Hex(message) !== messageHash) {
            throw new HttpError(STATUS.BadRequest, "message hash mismatch");
          }
        } else {
          throw new HttpError(STATUS.BadRequest, "unsupported payload type");
        }
      } else {
        if (!messageOverride || !signatureOverride) {
          throw new HttpError(
            STATUS.BadRequest,
            "message and signature required for detached verify",
          );
        }
        message = messageOverride;
        messageHash = sha256Hex(messageOverride);
        salt = typeof body.salt === "string" ? body.salt : "";
        signature = signatureOverride;
        fingerprint = "";
      }

      let contact: ExternalIdentity;
      if (publicIdentity && typeof publicIdentity === "object") {
        const candidate = publicIdentity as Record<string, unknown>;
        const signingKey = typeof candidate.signingKey === "string"
          ? candidate.signingKey
          : "";
        const signingKeyType = typeof candidate.signingKeyType === "string"
          ? candidate.signingKeyType
          : "";
        const encryptionKey = typeof candidate.encryptionKey === "string"
          ? candidate.encryptionKey
          : "";
        const encryptionKeyType =
          typeof candidate.encryptionKeyType === "string"
            ? candidate.encryptionKeyType
            : "";
        if (!signingKey || !signingKeyType) {
          throw new HttpError(
            STATUS.BadRequest,
            "public identity missing signing key",
          );
        }
        if (!encryptionKey || !encryptionKeyType) {
          throw new HttpError(
            STATUS.BadRequest,
            "public identity missing encryption key",
          );
        }
        if (!["dilithium", "sphincs"].includes(signingKeyType)) {
          throw new HttpError(
            STATUS.BadRequest,
            "public identity has invalid signing key type",
          );
        }
        if (encryptionKeyType !== "kyber") {
          throw new HttpError(
            STATUS.BadRequest,
            "public identity has invalid encryption key type",
          );
        }
        contact = {
          fingerprint: typeof candidate.fingerprint === "string"
            ? candidate.fingerprint
            : fingerprint,
          signingKey,
          signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
          signingKeyDetails: (candidate
            .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
            { variant: "ml_dsa87" },
          encryptionKey,
          encryptionKeyType: "kyber",
          encryptionKeyDetails: (candidate
            .encryptionKeyDetails as ExternalIdentity[
              "encryptionKeyDetails"
            ]) ?? { variant: "ml_kem1024" },
          details: (candidate.details as ExternalIdentity["details"]) ?? {},
        };
      } else {
        contact = await loadContact(
          ctx,
          sender ?? fingerprint.substring(0, 16),
        );
      }
      const verified = (Identity as typeof Identity & {
        VerifySignature: (
          sender: ExternalIdentity,
          value: string,
          sig: string,
          optionalSalt?: string,
        ) => boolean;
      }).VerifySignature(contact, message, signature, salt);
      return json({ verified });
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/v1/identity/fingerprint-from-public"
    ) {
      const body = await readJson<{ publicIdentity?: unknown }>(req);
      const publicIdentity = body.publicIdentity;
      if (!publicIdentity || typeof publicIdentity !== "object") {
        throw new HttpError(
          STATUS.BadRequest,
          "publicIdentity object is required",
        );
      }
      const candidate = publicIdentity as Record<string, unknown>;
      const signingKey = typeof candidate.signingKey === "string"
        ? candidate.signingKey
        : "";
      const signingKeyType = typeof candidate.signingKeyType === "string"
        ? candidate.signingKeyType
        : "";
      const encryptionKey = typeof candidate.encryptionKey === "string"
        ? candidate.encryptionKey
        : "";
      const encryptionKeyType = typeof candidate.encryptionKeyType === "string"
        ? candidate.encryptionKeyType
        : "";
      if (!signingKey || !signingKeyType) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity missing signing key",
        );
      }
      if (!encryptionKey || !encryptionKeyType) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity missing encryption key",
        );
      }
      if (!["dilithium", "sphincs"].includes(signingKeyType)) {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity has invalid signing key type",
        );
      }
      if (encryptionKeyType !== "kyber") {
        throw new HttpError(
          STATUS.BadRequest,
          "public identity has invalid encryption key type",
        );
      }
      const externalIdentity: ExternalIdentity = {
        fingerprint: typeof candidate.fingerprint === "string"
          ? candidate.fingerprint
          : "",
        signingKey,
        signingKeyType: signingKeyType as ExternalIdentity["signingKeyType"],
        signingKeyDetails: (candidate
          .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
          { variant: "ml_dsa87" },
        encryptionKey,
        encryptionKeyType: "kyber",
        encryptionKeyDetails: (candidate
          .encryptionKeyDetails as ExternalIdentity[
            "encryptionKeyDetails"
          ]) ?? { variant: "ml_kem1024" },
        details: (candidate.details as ExternalIdentity["details"]) ?? {},
      };
      const computedFingerprint = computeExternalFingerprint(externalIdentity);
      if (!computedFingerprint) {
        throw new HttpError(
          STATUS.BadRequest,
          "could not compute fingerprint from provided public identity",
        );
      }
      return json({ fingerprint: computedFingerprint });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/encrypt") {
      const body = await readJson<{
        message?: unknown;
        recipient?: unknown;
        sign?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        includePublicKeys?: unknown;
      }>(req);
      const message = typeof body.message === "string"
        ? body.message
        : undefined;
      const recipient = typeof body.recipient === "string"
        ? body.recipient
        : undefined;
      const sign = Boolean(body.sign);
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const includePublicKeys = Boolean(body.includePublicKeys);
      if (!message) {
        throw new HttpError(STATUS.BadRequest, "message is required");
      }
      if (!recipient) {
        throw new HttpError(STATUS.BadRequest, "recipient is required");
      }

      const ctx = await getContext(home, identityName);
      const contact = await loadContact(ctx, recipient);

      if (sign) {
        if (!password) {
          throw new HttpError(
            STATUS.BadRequest,
            "password is required when signing",
          );
        }
        const identity = await loadIdentity(ctx, password);
        const ciphertext = identity.signAndEncryptFor(message, contact);
        const summary = identity.summary;
        const senderIdentity = includePublicKeys
          ? {
            fingerprint: summary.fingerprint,
            signingKeyType: summary.signingKeyType,
            encryptionKeyType: summary.encryptionKeyType,
            signingKey: summary.signingKey,
            encryptionKey: summary.encryptionKey,
            signingKeyDetails: summary.signingKeyDetails,
            encryptionKeyDetails: summary.encryptionKeyDetails,
          }
          : undefined;
        return json(buildEncryptedSignedMessagePayload({
          recipientFingerprint: contact.fingerprint,
          senderFingerprint: identity.toFingerprint(),
          ciphertext,
          senderIdentity,
        }));
      }

      const ciphertext = Identity.EncryptFor(contact, message);
      return json(buildEncryptedMessagePayload({
        recipientFingerprint: contact.fingerprint,
        ciphertext,
      }));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/decrypt") {
      const body = await readJson<{
        payload?: unknown;
        password?: unknown;
        sender?: unknown;
        senderEmail?: unknown;
        home?: unknown;
        identity?: unknown;
      }>(req);
      const payload = body.payload as Record<string, unknown> | undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const sender = typeof body.sender === "string" ? body.sender : undefined;
      const senderEmail = typeof body.senderEmail === "string"
        ? body.senderEmail
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      if (!payload) {
        throw new HttpError(STATUS.BadRequest, "payload is required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);

      const type = payload.type;
      if (type === "ebp-encrypted-message") {
        const ciphertext = String(payload.ciphertext ?? "");
        let message: string;
        try {
          message = identity.encryptionKey.decrypt(ciphertext);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - message may be corrupted or not intended for this identity",
          );
        }
        return json({
          message,
          verified: null,
          verifyStatus: "unsigned",
          signerFingerprint: null,
          signerEmail: null,
          signerEmailVerified: null,
          signerMatchesSenderEmail: null,
          serverIdentityMatch: null,
        });
      }

      if (type === "ebp-encrypted-signed-message-multi") {
        const ciphertext = String(payload.ciphertext ?? "");
        const contentNonce = String(payload.contentNonce ?? "");
        const senderFp = typeof payload.senderFingerprint === "string"
          ? payload.senderFingerprint
          : undefined;
        const embeddedIdentity = payload.senderIdentity as
          | Record<string, unknown>
          | undefined;
        const recipientsRaw = Array.isArray(payload.recipients)
          ? payload.recipients
          : [];
        const recipients = recipientsRaw
          .map((entry) => ({
            fingerprint: typeof entry?.fingerprint === "string"
              ? entry.fingerprint
              : "",
            kemCiphertext: typeof entry?.kemCiphertext === "string"
              ? entry.kemCiphertext
              : "",
            keyWrapNonce: typeof entry?.keyWrapNonce === "string"
              ? entry.keyWrapNonce
              : "",
            wrappedContentKey: typeof entry?.wrappedContentKey === "string"
              ? entry.wrappedContentKey
              : "",
          }))
          .filter((entry) => (
            entry.fingerprint.length > 0 &&
            entry.kemCiphertext.length > 0 &&
            entry.keyWrapNonce.length > 0 &&
            entry.wrappedContentKey.length > 0
          ));
        if (!ciphertext || !contentNonce || recipients.length === 0) {
          throw new HttpError(
            STATUS.BadRequest,
            "invalid multi-recipient payload",
          );
        }

        let contact: ExternalIdentity | undefined;
        let isKnownContact = false;
        if (sender) {
          contact = await loadContact(ctx, sender);
          isKnownContact = true;
        } else if (senderFp) {
          try {
            contact = await loadContact(ctx, senderFp.substring(0, 16));
            isKnownContact = true;
          } catch {
            contact = undefined;
          }
        }
        if (!contact && embeddedIdentity) {
          const signingKey = typeof embeddedIdentity.signingKey === "string"
            ? embeddedIdentity.signingKey
            : undefined;
          const encryptionKey =
            typeof embeddedIdentity.encryptionKey === "string"
              ? embeddedIdentity.encryptionKey
              : undefined;
          if (signingKey && encryptionKey) {
            const signingKeyType = embeddedIdentity.signingKeyType === "sphincs"
              ? "sphincs" as const
              : "dilithium" as const;
            const ext: ExternalIdentity = {
              fingerprint: typeof embeddedIdentity.fingerprint === "string"
                ? embeddedIdentity.fingerprint
                : "",
              signingKeyType,
              encryptionKeyType: "kyber",
              signingKey,
              encryptionKey,
              signingKeyDetails: (embeddedIdentity
                .signingKeyDetails as ExternalIdentity[
                  "signingKeyDetails"
                ]) ?? {
                variant: signingKeyType === "sphincs"
                  ? "slh_dsa_sha2_256s"
                  : "ml_dsa87",
              },
              encryptionKeyDetails: (embeddedIdentity
                .encryptionKeyDetails as ExternalIdentity[
                  "encryptionKeyDetails"
                ]) ?? { variant: "ml_kem1024" },
              details: {},
            };
            const computed = computeExternalFingerprint(ext);
            if (computed && (!senderFp || computed === senderFp)) {
              ext.fingerprint = computed;
              contact = ext;
            }
          }
        }
        if (!contact) {
          throw new HttpError(
            STATUS.BadRequest,
            "sender contact is required for multi-recipient signed payloads",
          );
        }
        const computedFingerprint = computeExternalFingerprint(contact);
        if (
          !computedFingerprint || computedFingerprint !== contact.fingerprint ||
          (senderFp && computedFingerprint !== senderFp)
        ) {
          throw new HttpError(
            STATUS.BadRequest,
            "sender identity fingerprint mismatch",
          );
        }
        let result: ReturnType<Identity["decryptAndVerifyMulti"]>;
        try {
          result = identity.decryptAndVerifyMulti({
            recipients,
            contentNonce,
            ciphertext,
          }, contact);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - message may be corrupted or not intended for this identity",
          );
        }
        const signerEmail = getIdentityDetailValue(contact.details, "email");
        const emailMeta = getIdentityDetailMeta(
          (contact as ExternalIdentity & { detailsMeta?: unknown }).detailsMeta,
          "email",
        );
        const signerEmailVerified =
          emailMeta && typeof emailMeta.verified === "boolean"
            ? Boolean(emailMeta.verified)
            : null;
        const senderEmailNormalized = extractEmailAddress(senderEmail ?? "");
        const signerEmailNormalized = extractEmailAddress(signerEmail ?? "");
        const signerMatchesSenderEmail =
          senderEmailNormalized && signerEmailNormalized
            ? senderEmailNormalized === signerEmailNormalized
            : null;
        const status = result.verified
          ? (isKnownContact ? "valid" : "valid_unknown_signer")
          : "invalid";
        return json({
          message: result.message,
          verified: result.verified,
          verifyStatus: status,
          signerFingerprint: contact.fingerprint,
          signerEmail,
          signerEmailVerified,
          signerMatchesSenderEmail,
          serverIdentityMatch: null,
          contentKey: result.contentKey,
          recipientFingerprints: result.recipientFingerprints,
          attachmentManifest: result.attachmentManifest,
        });
      }

      if (type === "ebp-encrypted-signed-message") {
        const ciphertext = String(payload.ciphertext ?? "");
        const senderFp = typeof payload.senderFingerprint === "string"
          ? payload.senderFingerprint
          : undefined;
        const embeddedIdentity = payload.senderIdentity as
          | Record<string, unknown>
          | undefined;
        let contact: ExternalIdentity | undefined;
        let isKnownContact = false;
        let signerFingerprint: string | null = senderFp ?? null;
        let signerEmail: string | null = null;
        let signerEmailVerified: boolean | null = null;
        let signerMatchesSenderEmail: boolean | null = null;
        let serverIdentityMatch: boolean | null = null;

        const safeDecrypt = (ct: string): string => {
          try {
            return identity.encryptionKey.decrypt(ct);
          } catch {
            throw new HttpError(
              STATUS.BadRequest,
              "decryption failed - message may be corrupted or not intended for this identity",
            );
          }
        };

        const tryFetchFromServer = async (
          fp: string,
        ): Promise<ExternalIdentity | null> => {
          if (!ctx.server) return null;
          try {
            const res = await fetch(
              apiUrl(ctx.server, `/api/v1/identity/${fp}`),
            );
            if (!res.ok) return null;
            const data = await res.json();
            if (!data.signingKey || !data.encryptionKey) return null;
            return {
              fingerprint: data.fingerprint ?? fp,
              signingKeyType: data.signingKeyType === "sphincs"
                ? "sphincs"
                : "dilithium",
              encryptionKeyType: "kyber",
              signingKey: data.signingKey,
              encryptionKey: data.encryptionKey,
              signingKeyDetails: (data
                .signingKeyDetails as ExternalIdentity[
                  "signingKeyDetails"
                ]) ?? { variant: "ml_dsa87" },
              encryptionKeyDetails: (data
                .encryptionKeyDetails as ExternalIdentity[
                  "encryptionKeyDetails"
                ]) ?? { variant: "ml_kem1024" },
              details: data.details ?? {},
              detailsMeta: data.detailsMeta ?? {},
            };
          } catch {
            return null;
          }
        };

        const buildEmbeddedContact = (): ExternalIdentity | null => {
          if (!embeddedIdentity) return null;
          const signingKey = typeof embeddedIdentity.signingKey === "string"
            ? embeddedIdentity.signingKey
            : undefined;
          const encryptionKey =
            typeof embeddedIdentity.encryptionKey === "string"
              ? embeddedIdentity.encryptionKey
              : undefined;
          if (!signingKey || !encryptionKey) return null;
          const signingKeyType = embeddedIdentity.signingKeyType === "sphincs"
            ? "sphincs" as const
            : "dilithium" as const;
          const ext: ExternalIdentity = {
            fingerprint: typeof embeddedIdentity.fingerprint === "string"
              ? embeddedIdentity.fingerprint
              : "",
            signingKeyType,
            encryptionKeyType: "kyber",
            signingKey,
            encryptionKey,
            signingKeyDetails: (embeddedIdentity
              .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
              {
                variant: signingKeyType === "sphincs"
                  ? "slh_dsa_sha2_256s"
                  : "ml_dsa87",
              },
            encryptionKeyDetails: (embeddedIdentity
              .encryptionKeyDetails as ExternalIdentity[
                "encryptionKeyDetails"
              ]) ?? { variant: "ml_kem1024" },
            details: {},
          };
          const computed = computeExternalFingerprint(ext);
          if (!computed) return null;
          if (senderFp && computed !== senderFp) return null;
          ext.fingerprint = computed;
          return ext;
        };

        if (sender) {
          try {
            contact = await loadContact(ctx, sender);
            isKnownContact = true;
          } catch {
            if (senderFp) {
              contact = await tryFetchFromServer(senderFp) ?? undefined;
            }
            if (!contact) {
              const embedded = buildEmbeddedContact();
              if (embedded) {
                contact = embedded;
              } else {
                const message = safeDecrypt(ciphertext);
                try {
                  const inner = JSON.parse(message);
                  return json({
                    message: inner.message ?? message,
                    verified: null,
                    verifyStatus: "sender_not_found",
                    signerFingerprint,
                    signerEmail,
                    signerEmailVerified,
                    signerMatchesSenderEmail,
                    serverIdentityMatch,
                  });
                } catch {
                  return json({
                    message,
                    verified: null,
                    verifyStatus: "sender_not_found",
                    signerFingerprint,
                    signerEmail,
                    signerEmailVerified,
                    signerMatchesSenderEmail,
                    serverIdentityMatch,
                  });
                }
              }
            }
          }
        } else if (senderFp) {
          try {
            contact = await loadContact(ctx, senderFp.substring(0, 16));
            isKnownContact = true;
          } catch {
            contact = await tryFetchFromServer(senderFp) ?? undefined;
            if (!contact) {
              const embedded = buildEmbeddedContact();
              if (embedded) {
                contact = embedded;
              } else {
                const message = safeDecrypt(ciphertext);
                try {
                  const inner = JSON.parse(message);
                  return json({
                    message: inner.message ?? message,
                    verified: null,
                    verifyStatus: "sender_not_in_contacts",
                    signerFingerprint,
                    signerEmail,
                    signerEmailVerified,
                    signerMatchesSenderEmail,
                    serverIdentityMatch,
                  });
                } catch {
                  return json({
                    message,
                    verified: null,
                    verifyStatus: "sender_not_in_contacts",
                    signerFingerprint,
                    signerEmail,
                    signerEmailVerified,
                    signerMatchesSenderEmail,
                    serverIdentityMatch,
                  });
                }
              }
            }
          }
        } else {
          const embedded = buildEmbeddedContact();
          if (embedded) {
            contact = embedded;
            signerFingerprint = embedded.fingerprint;
          } else {
            const message = safeDecrypt(ciphertext);
            try {
              const inner = JSON.parse(message);
              return json({
                message: inner.message ?? message,
                verified: null,
                verifyStatus: "sender_not_specified",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            } catch {
              return json({
                message,
                verified: null,
                verifyStatus: "sender_not_specified",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            }
          }
        }

        try {
          const computedFingerprint = computeExternalFingerprint(contact);
          signerFingerprint = contact.fingerprint ?? signerFingerprint;
          signerEmail = getIdentityDetailValue(contact.details, "email");
          const emailMeta = getIdentityDetailMeta(
            (contact as ExternalIdentity & { detailsMeta?: unknown })
              .detailsMeta,
            "email",
          );
          signerEmailVerified =
            emailMeta && typeof emailMeta.verified === "boolean"
              ? Boolean(emailMeta.verified)
              : null;
          const senderEmailNormalized = extractEmailAddress(senderEmail ?? "");
          const signerEmailNormalized = extractEmailAddress(signerEmail ?? "");
          if (senderEmailNormalized && signerEmailNormalized) {
            signerMatchesSenderEmail =
              senderEmailNormalized === signerEmailNormalized;
          }
          if (
            !computedFingerprint || computedFingerprint !== contact.fingerprint
          ) {
            const message = safeDecrypt(ciphertext);
            try {
              const inner = JSON.parse(message);
              return json({
                message: inner.message ?? message,
                verified: false,
                verifyStatus: "fingerprint_mismatch",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            } catch {
              return json({
                message,
                verified: false,
                verifyStatus: "fingerprint_mismatch",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            }
          }
          if (senderFp && computedFingerprint !== senderFp) {
            const message = safeDecrypt(ciphertext);
            try {
              const inner = JSON.parse(message);
              return json({
                message: inner.message ?? message,
                verified: false,
                verifyStatus: "fingerprint_mismatch",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            } catch {
              return json({
                message,
                verified: false,
                verifyStatus: "fingerprint_mismatch",
                signerFingerprint,
                signerEmail,
                signerEmailVerified,
                signerMatchesSenderEmail,
                serverIdentityMatch,
              });
            }
          }
          const result = identity.decryptAndVerify(ciphertext, contact);

          if (
            result.verified && embeddedIdentity && !isKnownContact &&
            computedFingerprint
          ) {
            const serverIdentity = await tryFetchFromServer(
              computedFingerprint,
            );
            if (serverIdentity) {
              const serverFp = computeExternalFingerprint(serverIdentity);
              serverIdentityMatch = serverFp === computedFingerprint &&
                serverIdentity.signingKey === contact.signingKey &&
                serverIdentity.encryptionKey === contact.encryptionKey;
              if (serverIdentity.details) {
                const serverEmail = getIdentityDetailValue(
                  serverIdentity.details,
                  "email",
                );
                if (serverEmail) {
                  signerEmail = serverEmail;
                  const meta = getIdentityDetailMeta(
                    (serverIdentity as ExternalIdentity & {
                      detailsMeta?: unknown;
                    }).detailsMeta,
                    "email",
                  );
                  signerEmailVerified =
                    meta && typeof meta.verified === "boolean"
                      ? Boolean(meta.verified)
                      : null;
                  const sEnorm = extractEmailAddress(senderEmail ?? "");
                  const sigEnorm = extractEmailAddress(signerEmail ?? "");
                  if (sEnorm && sigEnorm) {
                    signerMatchesSenderEmail = sEnorm === sigEnorm;
                  }
                }
              }
            } else {
              serverIdentityMatch = false;
            }
          }

          if (result.verified) {
            // F-CRYPTO-02: distinguish recipient-bound (v2) from
            // legacy unbound (v1) signatures so the UI can flag
            // that recipient intent was not cryptographically
            // proven for v1 messages.
            const base = isKnownContact ? "valid" : "valid_unknown_signer";
            const status = result.verifyStatus === "valid_unbound"
              ? `${base}_unbound`
              : base;
            return json({
              message: result.message,
              verified: result.verified,
              verifyStatus: status,
              signerFingerprint,
              signerEmail,
              signerEmailVerified,
              signerMatchesSenderEmail,
              serverIdentityMatch,
            });
          } else {
            return json({
              message: result.message,
              verified: false,
              verifyStatus: "invalid",
              signerFingerprint,
              signerEmail,
              signerEmailVerified,
              signerMatchesSenderEmail,
              serverIdentityMatch,
            });
          }
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - message may be corrupted or not intended for this identity",
          );
        }
      }

      throw new HttpError(STATUS.BadRequest, "unsupported payload type");
    }

    if (req.method === "POST" && url.pathname === "/api/v1/encrypt-file") {
      const body = await readJson<{
        recipient?: unknown;
        sign?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        fileName?: unknown;
        mimeType?: unknown;
        fileDataBase64?: unknown;
      }>(req);
      const recipient = typeof body.recipient === "string"
        ? body.recipient
        : undefined;
      const sign = Boolean(body.sign);
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const fileNameRaw = typeof body.fileName === "string"
        ? body.fileName
        : "encrypted.bin";
      const mimeType =
        typeof body.mimeType === "string" && body.mimeType.length > 0
          ? body.mimeType
          : "application/octet-stream";
      const fileDataBase64 = typeof body.fileDataBase64 === "string"
        ? body.fileDataBase64
        : undefined;
      if (!recipient) {
        throw new HttpError(STATUS.BadRequest, "recipient is required");
      }
      if (!fileDataBase64) {
        throw new HttpError(STATUS.BadRequest, "fileDataBase64 is required");
      }
      const fileBytes = Uint8Array.from(
        atob(fileDataBase64),
        (c) => c.charCodeAt(0),
      );
      if (fileBytes.length > MAX_ENCRYPTED_FILE_BYTES) {
        throw new HttpError(
          STATUS.BadRequest,
          `file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
        );
      }

      const ctx = await getContext(home, identityName);
      const contact = await loadContact(ctx, recipient);
      const fileName = safeFileName(fileNameRaw);
      const envelope = createFileCleartextEnvelope(
        fileBytes,
        fileName,
        mimeType,
      );
      const cleartext = JSON.stringify(envelope);

      if (sign) {
        if (!password) {
          throw new HttpError(
            STATUS.BadRequest,
            "password is required when signing",
          );
        }
        const identity = await loadIdentity(ctx, password);
        const ciphertext = identity.signAndEncryptFor(cleartext, contact);
        return json({
          type: "ebp-encrypted-signed-file",
          version: ENCRYPTED_SIGNED_FILE_FORMAT_VERSION,
          recipientFingerprint: contact.fingerprint,
          senderFingerprint: identity.toFingerprint(),
          fileName,
          mimeType,
          fileSize: fileBytes.length,
          ciphertext,
        });
      }

      const ciphertext = Identity.EncryptFor(contact, cleartext);
      return json({
        type: "ebp-encrypted-file",
        version: ENCRYPTED_FILE_FORMAT_VERSION,
        recipientFingerprint: contact.fingerprint,
        fileName,
        mimeType,
        fileSize: fileBytes.length,
        ciphertext,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/decrypt-file") {
      const body = await readJson<{
        payload?: unknown;
        password?: unknown;
        sender?: unknown;
        home?: unknown;
        identity?: unknown;
      }>(req);
      const payload = body.payload as Record<string, unknown> | undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const sender = typeof body.sender === "string" ? body.sender : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      if (!payload) {
        throw new HttpError(STATUS.BadRequest, "payload is required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }
      const ciphertext = String(payload.ciphertext ?? "");
      if (!ciphertext) {
        throw new HttpError(STATUS.BadRequest, "payload missing ciphertext");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);

      let cleartextEnvelopeRaw = "";
      let verified: boolean | null = null;
      let verifyStatus = "unsigned";
      if (payload.type === "ebp-encrypted-file") {
        try {
          cleartextEnvelopeRaw = identity.encryptionKey.decrypt(ciphertext);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - payload may be corrupted or not intended for this identity",
          );
        }
      } else if (payload.type === "ebp-encrypted-signed-file") {
        let contact: ExternalIdentity;
        if (sender) {
          contact = await loadContact(ctx, sender);
        } else if (typeof payload.senderFingerprint === "string") {
          contact = await loadContact(
            ctx,
            payload.senderFingerprint.substring(0, 16),
          );
        } else {
          throw new HttpError(
            STATUS.BadRequest,
            "sender is required for signed file payloads",
          );
        }
        let result: {
          message: string;
          verified: boolean;
          verifyStatus: string;
        };
        try {
          result = identity.decryptAndVerify(ciphertext, contact);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - payload may be corrupted or not intended for this identity",
          );
        }
        cleartextEnvelopeRaw = result.message;
        verified = result.verified;
        // F-CRYPTO-02: propagate recipient-binding state
        // (valid, valid_unbound, invalid) to the UI so it can warn
        // the user when a v1 (unbound) signature is encountered.
        verifyStatus = result.verifyStatus;
      } else {
        throw new HttpError(STATUS.BadRequest, "unsupported file payload type");
      }

      const envelope = parseFileCleartextEnvelope(cleartextEnvelopeRaw);
      if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
        throw new HttpError(
          STATUS.BadRequest,
          `decrypted file exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
        );
      }
      const fileDataBase64 = bytesToBase64(envelope.fileBytes);
      return json({
        fileName: safeFileName(envelope.fileName),
        mimeType: envelope.mimeType || "application/octet-stream",
        fileSize: envelope.fileSize,
        fileDataBase64,
        verified,
        verifyStatus,
      });
    }

    if (
      req.method === "POST" &&
      url.pathname === "/api/v1/mail/decrypt-attachment"
    ) {
      const body = await readJson<{
        payload?: unknown;
        password?: unknown;
        sender?: unknown;
        home?: unknown;
        identity?: unknown;
        expectedBodyPayloadHash?: unknown;
        contentKey?: unknown;
        expectedAttachmentHash?: unknown;
      }>(req);
      const payloadInput = body.payload;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const sender = typeof body.sender === "string" ? body.sender : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const expectedBodyPayloadHash =
        typeof body.expectedBodyPayloadHash === "string"
          ? body.expectedBodyPayloadHash
          : undefined;
      const contentKey = typeof body.contentKey === "string"
        ? body.contentKey
        : undefined;
      const expectedAttachmentHash =
        typeof body.expectedAttachmentHash === "string"
          ? body.expectedAttachmentHash
          : undefined;
      if (!payloadInput) {
        throw new HttpError(STATUS.BadRequest, "payload is required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }
      const payload = parseEncryptedEmailAttachmentPayload(payloadInput);

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      let cleartextEnvelopeRaw = "";
      let verified: boolean | null = null;
      let verifyStatus = "unsigned";

      if (payload.type === "ebp-encrypted-email-attachment") {
        try {
          cleartextEnvelopeRaw = identity.encryptionKey.decrypt(
            payload.ciphertext,
          );
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - attachment may be corrupted or not intended for this identity",
          );
        }
      } else if (payload.type === "ebp-encrypted-signed-email-attachment") {
        let contact: ExternalIdentity;
        if (sender) {
          contact = await loadContact(ctx, sender);
        } else {
          contact = await loadContact(
            ctx,
            payload.senderFingerprint.substring(0, 16),
          );
        }
        let result: {
          message: string;
          verified: boolean;
          verifyStatus: string;
        };
        try {
          result = identity.decryptAndVerify(payload.ciphertext, contact);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - attachment may be corrupted or not intended for this identity",
          );
        }
        cleartextEnvelopeRaw = result.message;
        verified = result.verified;
        verifyStatus = result.verifyStatus;
      } else if (
        payload.type === "ebp-encrypted-signed-email-attachment-multi"
      ) {
        if (!contentKey) {
          throw new HttpError(
            STATUS.BadRequest,
            "contentKey is required for multi-recipient attachments",
          );
        }
        if (sender) {
          await loadContact(ctx, sender);
        } else {
          await loadContact(ctx, payload.senderFingerprint.substring(0, 16));
        }
        try {
          const cleartextBytes = MultiRecipientCipher.decryptWithContentKey(
            payload.ciphertext,
            payload.contentNonce,
            hexToBytes(contentKey),
          );
          cleartextEnvelopeRaw = new TextDecoder().decode(cleartextBytes);
        } catch {
          throw new HttpError(
            STATUS.BadRequest,
            "decryption failed - attachment may be corrupted or not intended for this identity",
          );
        }
        verified = null;
        verifyStatus = "valid";
      } else {
        throw new HttpError(
          STATUS.BadRequest,
          "unsupported encrypted email attachment payload type",
        );
      }

      const envelope = parseEmailAttachmentCleartextEnvelope(
        cleartextEnvelopeRaw,
      );
      if (envelope.fileSize > MAX_ENCRYPTED_FILE_BYTES) {
        throw new HttpError(
          STATUS.BadRequest,
          `decrypted attachment exceeds max supported size (${MAX_ENCRYPTED_FILE_BYTES} bytes)`,
        );
      }
      const manifestMatched = expectedBodyPayloadHash
        ? envelope.bodyPayloadHash === expectedBodyPayloadHash
        : null;
      if (manifestMatched === false) {
        verifyStatus = "manifest_mismatch";
      }
      if (
        expectedAttachmentHash &&
        expectedAttachmentHash !== sha256Hex(payload.ciphertext)
      ) {
        verifyStatus = "manifest_mismatch";
      }
      const fileDataBase64 = bytesToBase64(envelope.fileBytes);
      return json({
        attachmentId: envelope.attachmentId,
        fileName: safeFileName(envelope.fileName),
        mimeType: envelope.mimeType || "application/octet-stream",
        fileSize: envelope.fileSize,
        fileDataBase64,
        verified,
        verifyStatus,
        bodyPayloadHash: envelope.bodyPayloadHash ?? null,
        manifestMatched,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/detail") {
      const body = await readJson<{
        path?: unknown;
        detail?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        push?: unknown;
        server?: unknown;
      }>(req);
      const path = typeof body.path === "string" ? body.path : undefined;
      const detail = typeof body.detail === "string" ? body.detail : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const push = Boolean(body.push);
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!path || !detail) {
        throw new HttpError(STATUS.BadRequest, "path and detail are required");
      }
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);
      const detailToAttach = path.startsWith("opaque::")
        ? sha256Hex(detail)
        : detail;
      identity.attachDetail(path, detailToAttach);
      await saveIdentity(ctx, password, identity);

      if (push) {
        const server = resolveServer(ctx, serverOverride);
        const entry = identity.details.get(path);
        if (!entry) {
          throw new HttpError(
            STATUS.InternalServerError,
            "failed to locate attached detail",
          );
        }
        const [detailValue, proof] = entry;

        const res = await fetch(apiUrl(server, "/api/v1/detail"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fingerprint: identity.toFingerprint(),
            path,
            detail: detailValue,
            proof,
          }),
        });

        if (!res.ok) {
          let reason = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) reason = body.error;
          } catch {
            // ignore
          }
          throw new HttpError(
            STATUS.BadGateway,
            `failed to push detail: ${reason}`,
          );
        }
      }

      return json({ ok: true, path, detail: detailToAttach });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/verify-email/request"
    ) {
      const body = await readJson<{
        home?: unknown;
        identity?: unknown;
        server?: unknown;
        fingerprint?: unknown;
        detail?: unknown;
      }>(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      const providedFingerprint = typeof body.fingerprint === "string"
        ? body.fingerprint
        : undefined;
      const detail = typeof body.detail === "string" ? body.detail : undefined;

      const ctx = await getContext(home, identityName);
      const server = resolveServer(ctx, serverOverride);
      const publicData = await loadIdentityPublic(ctx);
      const fingerprint = providedFingerprint ?? publicData?.fingerprint ??
        null;
      if (!fingerprint) {
        throw new HttpError(STATUS.NotFound, "identity fingerprint not found");
      }

      const res = await fetch(apiUrl(server, "/api/v1/verify-email/request"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          detail,
        }),
      });

      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) reason = body.error;
        } catch {
          // ignore
        }
        throw new HttpError(
          STATUS.BadGateway,
          `failed to send verification email: ${reason}`,
        );
      }

      const payload = await res.json();
      return json(payload);
    }

    if (req.method === "POST" && url.pathname === "/api/v1/publish") {
      const body = await readJson<{
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        server?: unknown;
      }>(req);
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const server = resolveServer(ctx, serverOverride);
      const identity = await loadIdentity(ctx, password);
      const summary = identity.summary;

      let serverIdentity: ExternalIdentity | null = null;
      try {
        const res = await fetch(
          apiUrl(server, `/api/v1/identity/${summary.fingerprint}`),
        );
        if (res.ok) {
          const body = await res.json();
          serverIdentity = {
            fingerprint: body.fingerprint,
            signingKeyType: body.signingKeyType,
            encryptionKeyType: body.encryptionKeyType,
            signingKey: body.signingKey,
            encryptionKey: body.encryptionKey,
            signingKeyDetails: (body
              .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
              { variant: "ml_dsa87" },
            encryptionKeyDetails: (body
              .encryptionKeyDetails as ExternalIdentity[
                "encryptionKeyDetails"
              ]) ?? { variant: "ml_kem1024" },
            details: body.details ?? {},
          };
        } else if (res.status !== 404) {
          const body = await res.json().catch(() => ({}));
          const reason = (body as { error?: string } | undefined)?.error ??
            `HTTP ${res.status}`;
          throw new HttpError(
            STATUS.BadGateway,
            `failed to query server identity: ${reason}`,
          );
        }
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(
          STATUS.BadGateway,
          `failed to query server identity: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }

      if (serverIdentity) {
        if (
          serverIdentity.signingKey !== summary.signingKey ||
          serverIdentity.encryptionKey !== summary.encryptionKey ||
          serverIdentity.signingKeyType !== summary.signingKeyType ||
          serverIdentity.encryptionKeyType !== summary.encryptionKeyType
        ) {
          throw new HttpError(
            STATUS.Conflict,
            "server identity keys differ from local identity",
          );
        }
      }

      const serverDetails: Record<string, [string, string]> =
        serverIdentity?.details ?? {};
      const serverState = serverIdentity
        ? buildStateFromExternal(serverIdentity, serverDetails)
        : null;
      const fromState = serverState ? computeStateHash(serverState) : null;

      const nextState = buildStateFromExternal(
        {
          ...summary,
          details: serverDetails,
        },
        serverDetails,
      );
      const toState = computeStateHash(nextState);
      const transitionMessage = stableStringify({ fromState, toState });
      const stateSignature = identity.signMessage(transitionMessage);

      const publishPayload = {
        signingKeyType: summary.signingKeyType,
        encryptionKeyType: summary.encryptionKeyType,
        signingKey: summary.signingKey,
        encryptionKey: summary.encryptionKey,
        signingKeyDetails: summary.signingKeyDetails,
        encryptionKeyDetails: summary.encryptionKeyDetails,
        fingerprint: summary.fingerprint,
        fromState,
        toState,
        stateSignature,
      };

      const res = await fetch(apiUrl(server, "/api/v1/identity"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(publishPayload),
      });

      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) reason = body.error;
        } catch {
          // ignore
        }
        throw new HttpError(
          STATUS.BadGateway,
          `failed to publish identity: ${reason}`,
        );
      }

      return json({ ok: true, fingerprint: summary.fingerprint });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/fetch") {
      const body = await readJson<{
        fingerprint?: unknown;
        name?: unknown;
        home?: unknown;
        server?: unknown;
      }>(req);
      const fingerprint = typeof body.fingerprint === "string"
        ? body.fingerprint
        : undefined;
      const name = typeof body.name === "string" ? body.name : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!fingerprint) {
        throw new HttpError(STATUS.BadRequest, "fingerprint is required");
      }
      if (!isValidFingerprintBech32(fingerprint)) {
        throw new HttpError(
          STATUS.BadRequest,
          "fingerprint must be valid bech32",
        );
      }

      const ctx = await getContext(home);
      const server = resolveServer(ctx, serverOverride);
      const res = await fetch(
        apiUrl(server, `/api/v1/identity/${fingerprint}`),
      );
      let bodyJson: unknown = {};
      try {
        bodyJson = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok) {
        const reason = (bodyJson as { error?: string } | undefined)?.error ??
          `HTTP ${res.status}`;
        throw new HttpError(
          STATUS.BadGateway,
          `failed to fetch identity: ${reason}`,
        );
      }

      const b = bodyJson as {
        fingerprint?: string;
        signingKeyType?: string;
        encryptionKeyType?: string;
        signingKey?: string;
        encryptionKey?: string;
        signingKeyDetails?: unknown;
        encryptionKeyDetails?: unknown;
        details?: Record<string, [string, string]>;
        detailsMeta?: Record<
          string,
          { verified: boolean; verifiedAt: number | null }
        >;
        revokedDetails?: string[];
        revoked?: boolean;
      };

      const signingKeyType = b?.signingKeyType === "sphincs"
        ? "sphincs" as const
        : "dilithium" as const;
      const encryptionKeyType = "kyber" as const;

      const details = { ...(b?.details ?? {}) };
      const detailsMeta = { ...(b?.detailsMeta ?? {}) };
      const revokedDetails = b?.revokedDetails ?? [];
      for (const path of revokedDetails) {
        delete details[path];
        delete detailsMeta[path];
      }

      const external: ExternalIdentity = {
        fingerprint: b?.fingerprint ?? fingerprint,
        signingKeyType,
        encryptionKeyType,
        signingKey: b?.signingKey ?? "",
        encryptionKey: b?.encryptionKey ?? "",
        signingKeyDetails:
          (b?.signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
            { variant: "ml_dsa87" },
        encryptionKeyDetails: (b?.encryptionKeyDetails as ExternalIdentity[
          "encryptionKeyDetails"
        ]) ?? { variant: "ml_kem1024" },
        details,
        detailsMeta,
      };

      if (!external.signingKey || !external.encryptionKey) {
        throw new HttpError(
          STATUS.BadGateway,
          "invalid identity payload from server",
        );
      }

      await ensurePrivateDir(ctx.contactsDir);
      const contactName = name ?? external.fingerprint.substring(0, 16);
      const contactPath = `${ctx.contactsDir}/${contactName}.json`;
      try {
        const existingRaw = await Deno.readTextFile(contactPath);
        const existing = JSON.parse(existingRaw) as
          & ExternalIdentity
          & Record<string, unknown>;
        const preservedEntries = Object.entries(
          existing.resolvedOpaqueDetails ?? {},
        ).filter(
          ([path, value]) =>
            typeof value === "string" && details[path] !== undefined,
        );
        if (preservedEntries.length > 0) {
          external.resolvedOpaqueDetails = Object.fromEntries(preservedEntries);
        }
        const localFields = [
          "localAlias",
          "localDescription",
          "localEmail",
        ] as const;
        for (const key of localFields) {
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

      return json({
        ok: true,
        name: contactName,
        fingerprint: external.fingerprint,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/server") {
      const home = url.searchParams.get("home") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const state = await readState(ctx.identityDir);
      return json({ server: state?.server ?? null });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/server") {
      const body = await readJson<
        { url?: unknown; clear?: unknown; home?: unknown }
      >(req);
      const home = typeof body.home === "string" ? body.home : undefined;
      const urlValue = typeof body.url === "string" ? body.url : undefined;
      const clear = Boolean(body.clear);
      const ctx = await getContext(home);

      if (clear) {
        const state = await updateState(ctx.identityDir, { server: undefined });
        return json({ ok: true, server: state.server ?? null });
      }

      if (!urlValue) throw new HttpError(STATUS.BadRequest, "url is required");
      const state = await updateState(ctx.identityDir, { server: urlValue });
      return json({ ok: true, server: state.server ?? null });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/revoke/detail") {
      const body = await readJson<{
        path?: unknown;
        reason?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        push?: unknown;
        server?: unknown;
      }>(req);
      const path = typeof body.path === "string" ? body.path : undefined;
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const push = Boolean(body.push);
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!path) throw new HttpError(STATUS.BadRequest, "path is required");
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);

      if (!identity.details.has(path)) {
        throw new HttpError(STATUS.NotFound, "detail not found");
      }

      const certificate = identity.revokeDetail(path, reason);
      await saveIdentity(ctx, password, identity);

      if (push) {
        const server = resolveServer(ctx, serverOverride);
        const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fingerprint: identity.toFingerprint(),
            type: "detail",
            target: path,
            certificate,
          }),
        });

        if (!res.ok) {
          let pushReason = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) pushReason = body.error;
          } catch {
            // ignore
          }
          throw new HttpError(
            STATUS.BadGateway,
            `failed to push revocation: ${pushReason}`,
          );
        }
      }

      return json({ ok: true, path, revoked: true });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/revoke/identity") {
      const body = await readJson<{
        reason?: unknown;
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        push?: unknown;
        server?: unknown;
      }>(req);
      const reason = typeof body.reason === "string" ? body.reason : undefined;
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;
      const push = Boolean(body.push);
      const serverOverride = typeof body.server === "string"
        ? body.server
        : undefined;
      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password is required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);

      if (identity.isRevoked()) {
        throw new HttpError(STATUS.Conflict, "identity is already revoked");
      }

      const certificate = identity.createIdentityRevocation(reason);
      await saveIdentity(ctx, password, identity);

      if (push) {
        const server = resolveServer(ctx, serverOverride);
        const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fingerprint: identity.toFingerprint(),
            type: "identity",
            certificate,
          }),
        });

        if (!res.ok) {
          let pushReason = `HTTP ${res.status}`;
          try {
            const body = await res.json();
            if (body?.error) pushReason = body.error;
          } catch {
            // ignore
          }
          throw new HttpError(
            STATUS.BadGateway,
            `failed to push revocation: ${pushReason}`,
          );
        }
      }

      return json({
        ok: true,
        revoked: true,
        fingerprint: identity.toFingerprint(),
      });
    }

    if (
      req.method === "POST" && url.pathname === "/api/v1/revoke/emergency-cert"
    ) {
      const body = await readJson<{
        password?: unknown;
        home?: unknown;
        identity?: unknown;
      }>(req);
      const password = typeof body.password === "string"
        ? body.password
        : undefined;
      const home = typeof body.home === "string" ? body.home : undefined;
      const identityName = typeof body.identity === "string"
        ? body.identity
        : undefined;

      if (!password) {
        throw new HttpError(STATUS.BadRequest, "password required");
      }

      const ctx = await getContext(home, identityName);
      const identity = await loadIdentity(ctx, password);

      const emergencyCert = identity.generateEmergencyRevocationCertificate();

      return json({
        type: "ebp-emergency-revocation-certificate",
        version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
        fingerprint: identity.toFingerprint(),
        certificate: emergencyCert,
        createdAt: new Date().toISOString(),
        warning:
          "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/server/identities") {
      const home = url.searchParams.get("home") ?? undefined;
      const serverOverride = url.searchParams.get("server") ?? undefined;
      const page = url.searchParams.get("page") ?? undefined;
      const query = url.searchParams.get("query") ??
        url.searchParams.get("q") ?? undefined;
      const ctx = await getContext(home ?? undefined);
      const server = resolveServer(ctx, serverOverride ?? undefined);

      const path = query ? "/api/v1/identities/search" : "/api/v1/identities";
      const serverUrl = new URL(apiUrl(server, path));
      if (page) serverUrl.searchParams.set("page", page);
      if (query) serverUrl.searchParams.set("query", query);

      const res = await fetch(serverUrl.toString());
      let bodyJson: unknown = {};
      try {
        bodyJson = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok) {
        const reason = (bodyJson as { error?: string } | undefined)?.error ??
          `HTTP ${res.status}`;
        throw new HttpError(
          STATUS.BadGateway,
          `failed to list server identities: ${reason}`,
        );
      }

      const entriesRaw = (bodyJson as { identities?: unknown[] } | undefined)
        ?.identities;
      if (!Array.isArray(entriesRaw)) {
        throw new HttpError(STATUS.BadGateway, "invalid response from server");
      }

      const entries = entriesRaw
        .map((v) => {
          if (!v || typeof v !== "object") return undefined;
          const obj = v as Record<string, unknown>;
          const fingerprint = typeof obj.fingerprint === "string"
            ? obj.fingerprint
            : undefined;
          if (!fingerprint) return undefined;
          const signingKeyType = typeof obj.signingKeyType === "string"
            ? obj.signingKeyType
            : undefined;
          const encryptionKeyType = typeof obj.encryptionKeyType === "string"
            ? obj.encryptionKeyType
            : undefined;
          const createdAt = typeof obj.createdAt === "number"
            ? obj.createdAt
            : undefined;
          const details = typeof obj.details === "object" && obj.details
            ? obj.details as Record<string, [string, string] | string>
            : {};
          return {
            fingerprint,
            signingKeyType,
            encryptionKeyType,
            createdAt,
            details,
          };
        })
        .filter((v): v is NonNullable<typeof v> => !!v);

      const pagination = (bodyJson as { pagination?: unknown } | undefined)
        ?.pagination;

      return json({ identities: entries, pagination });
    }

    if (req.method === "POST" && url.pathname === "/api/v1/save-file") {
      const body = await readJson<{
        content?: unknown;
        base64Content?: unknown;
        filename?: unknown;
        mimeType?: unknown;
      }>(req);
      const filename = typeof body.filename === "string"
        ? body.filename.trim()
        : "";
      if (!filename) {
        throw new HttpError(STATUS.BadRequest, "filename is required");
      }
      if (/[/\\]/.test(filename) || filename === ".." || filename === ".") {
        throw new HttpError(
          STATUS.BadRequest,
          "filename must not contain path separators",
        );
      }
      const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
      if (!home) {
        throw new HttpError(
          STATUS.InternalServerError,
          "could not determine home directory",
        );
      }
      const downloadsDir = `${home}/Downloads`;
      await ensureDir(downloadsDir);
      const filePath = `${downloadsDir}/${filename}`;
      if (typeof body.base64Content === "string") {
        const binary = Uint8Array.from(
          atob(body.base64Content),
          (c) => c.charCodeAt(0),
        );
        await Deno.writeFile(filePath, binary);
      } else if (typeof body.content === "string") {
        await Deno.writeTextFile(filePath, body.content);
      } else {
        throw new HttpError(
          STATUS.BadRequest,
          "content or base64Content is required",
        );
      }
      return json({ path: filePath });
    }

    return json({ error: "not found" }, STATUS.NotFound);
  } catch (err) {
    if (err instanceof HttpError) {
      return json(
        { error: err.message, details: err.details ?? undefined },
        err.status,
      );
    }
    console.error(err);
    return json({ error: "internal server error" }, STATUS.InternalServerError);
  }
}
