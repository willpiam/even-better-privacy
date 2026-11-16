import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import {
  type MultiRecipientAttachmentManifestEntry,
  sha256Hex,
} from "../../core/MessageHash.ts";
import { includeSenderAmongRecipients } from "../../common/SentMailbox.ts";
import { MultiRecipientCipher } from "../../core/MultiRecipientCipher.ts";
import { hexToBytes } from "../../core/Hex.ts";
import {
  buildEncryptedSignedMessageMultiPayload,
  buildEncryptedSignedMessagePayload,
} from "../../core/Payloads.ts";
import {
  createEmailAttachmentCleartextEnvelope,
  parseEncryptedEmailAttachmentPayload,
} from "../../core/EmailAttachmentPayload.ts";
import { getContext } from "../../cli/utils.ts";
import { HttpError, json, randomHex, readJson, STATUS } from "./http.ts";
import { toSafeString } from "./identity.ts";
import { loadIdentityForRequest } from "./unlock-session.ts";
import { loadContact } from "./contacts.ts";
import {
  DEFAULT_MAIL_ACCOUNT,
  getMailSecretsStatus,
  getMailSecretsStore,
  getMailStore,
  type MailAccountRecord,
  type MailAuthSecrets,
  normalizeMailConfig,
  resolveMailAccount,
  saveMailSecretsStore,
  saveMailStore,
} from "./mail-account.ts";
import {
  buildImapClient,
  extractEbpPayload,
  getAddressText,
  isMessageSeen,
  mailListSearchQuery,
  parseMailSourceInWorker,
  resolveMailboxFolder,
  safeImapDisconnect,
  withImapReconnect,
  withMailboxLock,
  withTimeout,
} from "./mail-imap.ts";
import { buildSmtpTransport, deliverSmtpAndAppendSent } from "./mail-send.ts";
import {
  durationMs,
  EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE,
  formatMessageId,
  hashPayload,
  parseMailAttachmentInputs,
  parseMailRecipientsInput,
  sourceByteLength,
} from "./route-support.ts";

export async function handleMailRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
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
      throw new HttpError(
        STATUS.Unauthorized,
        "Mail credentials are locked; unlock your identity",
      );
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

  if (req.method === "POST" && url.pathname === "/api/v1/mail/account") {
    const body = await readJson<{
      home?: unknown;
      account?: unknown;
      accountId?: unknown;
      createNew?: unknown;
      accountName?: unknown;
      imapPassword?: unknown;
      smtpPassword?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const ctx = await getContext(home ?? undefined);
    await loadIdentityForRequest(ctx);
    if ((await getMailSecretsStatus(ctx.identityDir)).locked) {
      throw new HttpError(
        STATUS.Conflict,
        "Mail credentials are locked; unlock your identity",
      );
    }
    const accountPayload = body.account && typeof body.account === "object"
      ? body.account as Record<string, unknown>
      : null;
    const requestedAccountId = toSafeString(body.accountId, 128);
    const createNew = Boolean(body.createNew);
    const accountName = toSafeString(body.accountName, 128) || "Mail account";
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
    };
    secretStore[accountId] = nextSecrets;
    await saveMailSecretsStore(ctx.identityDir, secretStore);
    return json({
      ok: true,
      accountId,
      accountName: nextRecord.name,
      account: accountConfig,
      selectedAccountId: store.selectedAccountId,
      hasImapPassword: Boolean(nextSecrets.imapPassword),
      hasSmtpPassword: Boolean(nextSecrets.smtpPassword),
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

    const transport = buildSmtpTransport(account, secrets);
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
          const opened = await resolveMailboxFolder(imap, folder);
          if (!opened) {
            return json({
              accountId: resolved.account.id,
              folder,
              messages: [],
              pagination: { page: 1, totalPages: 1, total: 0 },
              _timing: {
                resolveMs,
                searchMs,
                fetchMs,
                totalMs: durationMs(requestStartedAt),
                mailboxExists,
                fetchedCount,
              },
            });
          }
          return await withMailboxLock(imap, opened, async () => {
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
              seen: isMessageSeen((msg as { flags?: Iterable<string> }).flags),
              size: typeof (msg as { size?: number }).size === "number"
                ? (msg as { size: number }).size
                : null,
            });

            const searchStartedAt = performance.now();
            const uids = await imap.search(
              mailListSearchQuery(searchQuery),
              { uid: true },
            );
            searchMs = durationMs(searchStartedAt);
            if (!uids || uids.length === 0) {
              return json({
                accountId: resolved.account.id,
                folder,
                messages: [],
                pagination: { page: 1, totalPages: 1, total: 0 },
                _timing: {
                  resolveMs,
                  searchMs,
                  fetchMs,
                  totalMs: durationMs(requestStartedAt),
                  mailboxExists,
                  fetchedCount,
                },
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
        } resolveMs=${resolveMs} searchMs=${searchMs} fetchMs=${fetchMs} totalMs=${
          durationMs(requestStartedAt)
        } mailboxExists=${mailboxExists} fetchedCount=${fetchedCount}`,
      );
      return response;
    } catch (err) {
      console.warn(
        `mail/messages error account=${resolved.account.id} folder=${folder} search=${
          searchQuery ? "yes" : "no"
        } resolveMs=${resolveMs} searchMs=${searchMs} fetchMs=${fetchMs} totalMs=${
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
          const opened = await resolveMailboxFolder(imap, folder);
          if (!opened) {
            throw new HttpError(STATUS.NotFound, "Sent mailbox not found");
          }
          const lockStartedAt = performance.now();
          return await withMailboxLock(imap, opened, async () => {
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
        `mail/message account=${resolved.account.id} folder=${folder} uid=${uid} resolveMs=${resolveMs} connectMs=${connectMs} lockMs=${lockMs} fetchMs=${fetchMs} parseMs=${parseMs} attachMs=${attachMs} totalMs=${
          durationMs(requestStartedAt)
        } bytes=${sourceBytes}`,
      );
      return response;
    } catch (err) {
      console.warn(
        `mail/message error account=${resolved.account.id} folder=${folder} uid=${uid} resolveMs=${resolveMs} connectMs=${connectMs} lockMs=${lockMs} fetchMs=${fetchMs} parseMs=${parseMs} attachMs=${attachMs} totalMs=${
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
        const opened = await resolveMailboxFolder(imap, folder);
        if (!opened) {
          throw new HttpError(STATUS.NotFound, "Sent mailbox not found");
        }
        return await withMailboxLock(imap, opened, async () => {
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
      `mail/message/attachment account=${resolved.account.id} folder=${folder} uid=${uid} index=${index} resolveMs=${resolveMs} fetchMs=${fetchMs} parseMs=${parseMs} totalMs=${
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
    const from = account.fromName
      ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
      : account.fromEmail;
    const envelopeTo = to.split(",").map((item) => item.trim()).filter(
      Boolean,
    );
    const delivered = await deliverSmtpAndAppendSent({
      account,
      secrets,
      envelopeTo,
      mail: {
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
      },
    });
    return json({
      ok: true,
      accountId: resolved.account.id,
      messageId: delivered.messageId,
      savedToSent: delivered.savedToSent,
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
      inReplyTo?: unknown;
      references?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const accountId = toSafeString(body.accountId, 128) || undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const to = toSafeString(body.to, 512);
    const subject = toSafeString(body.subject, 512);
    const message = typeof body.message === "string" ? body.message : "";
    const inReplyTo = formatMessageId(
      typeof body.inReplyTo === "string" ? body.inReplyTo : "",
    );
    const references = formatMessageId(
      typeof body.references === "string" ? body.references : "",
    );
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
    if (!message && attachmentsInput.length === 0) {
      throw new HttpError(
        STATUS.BadRequest,
        "message or attachments are required",
      );
    }

    const ctx = await getContext(home ?? undefined, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
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
    const encryptFor = includeSenderAmongRecipients(
      recipients.map((item) => item.contact),
      identity.summary,
    );
    if (encryptFor.length === 1) {
      const contact = encryptFor[0];
      const bodyCiphertext = identity.signAndEncryptFor(
        message,
        contact,
      );
      bodyPayload = buildEncryptedSignedMessagePayload({
        recipientFingerprint: contact.fingerprint,
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
          contact,
        );
        return {
          type: "ebp-encrypted-signed-email-attachment" as const,
          version: FILE_FORMAT_VERSIONS.encryptedSignedEmailAttachment,
          recipientFingerprint: contact.fingerprint,
          senderFingerprint: identity.toFingerprint(),
          attachmentId,
          ciphertext,
        };
      });
    } else {
      const contacts = encryptFor;
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

    const from = account.fromName
      ? `"${account.fromName.replace(/"/g, "")}" <${account.fromEmail}>`
      : account.fromEmail;
    const delivered = await deliverSmtpAndAppendSent({
      account,
      secrets,
      envelopeTo: recipients.map((item) => item.email),
      mail: {
        from,
        to: toHeader,
        subject,
        text: armoredBody,
        inReplyTo: inReplyTo || undefined,
        references: references || undefined,
        attachments: encryptedAttachments.map((attachment, idx) => ({
          filename: `ebp-attachment-${idx + 1}.json`,
          contentType: EBP_ENCRYPTED_ATTACHMENT_CONTENT_TYPE,
          content: new TextEncoder().encode(
            JSON.stringify(attachment, null, 2),
          ),
        })),
      },
    });
    return json({
      ok: true,
      accountId: resolved.account.id,
      messageId: delivered.messageId,
      savedToSent: delivered.savedToSent,
      attachmentCount: encryptedAttachments.length,
    });
  }

  return null;
}
