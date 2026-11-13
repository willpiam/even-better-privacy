import { mailPageCache, mailBodyCache, mailCacheScope, clearMailCache, onMailCacheClear, resetMailReader } from "./mail-cache.js";
import { state, saveBooleanPreference, MAIL_RENDER_HTML_PREF_KEY, MAIL_INCLUDE_PUBLIC_KEYS_PREF_KEY } from "./state.js";
import { api, setStatus, withLoading, escapeHtml } from "./ui.js";
import { requestPassword, requestTextInput } from "./modals.js";
import { ensureIdentityUnlocked, isIdentityUnlocked, isUnlockCancelled, withIdentity } from "./unlock.js";
import { updateMailComposeSendState, setMailTab, initMailTabs, syncMailFolderCustomUi, getSelectedMailFolder } from "./contact-search.js";
import { updateVerifyResult, applyVerifyResultBadge, autoFillSenderContact, extractEbpPayloadFromText, extractEmailAddress, renderMailVerifyMeta, loadAll } from "./render.js";
import { renderMailAuthenticityBadge, openMailAuthenticityModal, initMailAuthenticityModal } from "./mail-authenticity.js";
import {
  deriveComposeIntent,
  getChips as getComposeChips,
  initComposeRecipients,
  setChips as setComposeChips,
} from "./compose-recipients.js";

function isSentFolderView(folder) {
  const name = String(folder || "").trim().toLowerCase();
  return name === "sent"
    || name === "sent items"
    || name === "sent messages"
    || name === "[gmail]/sent mail"
    || name === "inbox.sent";
}

let mailMessageAbortController = null;
let mailMessageTimeoutId = null;
let mailMessageAbortReason = "";
const MAIL_MESSAGE_TIMEOUT_MS = 30_000;
let mailListAbortController = null;
let mailListRequestId = 0;
let mailListFolder = null;
onMailCacheClear(() => {
  cancelMailMessageRequest();
  mailListAbortController?.abort();
  mailListRequestId += 1;
  setMailMessageLoading(false);
  renderMailMessages();
  renderMailPagination();
  renderSelectedMailMessageBody();
  updateVerifyResult("mail-verify-result", null, null);
  renderMailVerifyMeta(null);
});

async function loadMailMessageDetail(folder, uid, signal) {
  const scope = mailCacheScope();
  const key = JSON.stringify([scope, folder, String(uid)]);
  const cached = mailBodyCache.get(key);
  if (cached) return cached;
  const accountQ = state.selectedMailAccountId ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}` : "";
  const detail = await api(`/mail/message?folder=${encodeURIComponent(folder)}&uid=${encodeURIComponent(String(uid))}${accountQ}`, { signal });
  if (scope === mailCacheScope() && !signal?.aborted) mailBodyCache.set(key, detail);
  return detail;
}

function cancelMailMessageRequest(reason = "request aborted") {
  if (mailMessageTimeoutId !== null) {
    clearTimeout(mailMessageTimeoutId);
    mailMessageTimeoutId = null;
  }
  if (mailMessageAbortController) {
    mailMessageAbortReason = reason;
    mailMessageAbortController.abort(reason);
    mailMessageAbortController = null;
  }
}

export async function loadMailAccount() {
  try {
    const res = await api("/mail/account");
    state.mailAccounts = res?.accounts || [];
    const nextAccountId = res?.selectedAccountId || res?.accountId || null;
    if (nextAccountId !== state.selectedMailAccountId
      || JSON.stringify(res?.account || null) !== JSON.stringify(state.mailAccount)) clearMailCache();
    state.selectedMailAccountId = nextAccountId;
    state.mailCreatingNewAccount = false;
    state.mailSecretsInMemory = Boolean(res?.secretsInMemory);
    state.mailSecretsLocked = Boolean(res?.secretsLocked);
    state.mailAccount = res?.account || null;
    const accountSelect = document.getElementById("mail-account-select");
    if (accountSelect) {
      accountSelect.innerHTML = "";
      if (!state.mailAccounts.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "(none)";
        accountSelect.appendChild(option);
      } else {
        for (const account of state.mailAccounts) {
          const option = document.createElement("option");
          option.value = account.id;
          option.textContent = account.name;
          accountSelect.appendChild(option);
        }
      }
      accountSelect.value = state.selectedMailAccountId || "";
    }
    if (!state.mailAccount) {
      document.getElementById("mail-account-name").value = "";
      const composeFrom = document.getElementById("mail-compose-from");
      if (composeFrom) composeFrom.value = "";
      syncManagedMailboxActions();
      return;
    }
    document.getElementById("mail-account-name").value = res?.accountName || "";
    document.getElementById("mail-imap-host").value = state.mailAccount.imapHost || "";
    document.getElementById("mail-imap-port").value = String(state.mailAccount.imapPort || 993);
    document.getElementById("mail-imap-secure").checked = Boolean(state.mailAccount.imapSecure);
    document.getElementById("mail-smtp-host").value = state.mailAccount.smtpHost || "";
    document.getElementById("mail-smtp-port").value = String(state.mailAccount.smtpPort || 465);
    document.getElementById("mail-smtp-secure").checked = Boolean(state.mailAccount.smtpSecure);
    document.getElementById("mail-username").value = state.mailAccount.username || "";
    document.getElementById("mail-from-email").value = state.mailAccount.fromEmail || "";
    document.getElementById("mail-compose-from").value = state.mailAccount.fromEmail || "";
    document.getElementById("mail-from-name").value = state.mailAccount.fromName || "";
    document.getElementById("mail-persist-secrets").checked = Boolean(state.mailAccount.persistSecrets);
    await refreshManagedMailboxActions();
  } catch (err) {
    console.warn("Could not load mail account", err);
  }
}

let managedMailDomain = "";

function mailboxEmailOnManagedDomain(email) {
  const domain = managedMailDomain.trim().toLowerCase();
  const address = (email || "").trim().toLowerCase();
  if (!domain || !address.includes("@")) return false;
  return address.endsWith(`@${domain}`);
}

function syncManagedMailboxActions() {
  const wrap = document.getElementById("mail-ebp-managed-actions");
  if (!wrap) return;
  const email = state.mailCreatingNewAccount ? "" : (state.mailAccount?.fromEmail || "");
  const show = mailboxEmailOnManagedDomain(email);
  wrap.hidden = !show;
  wrap.style.display = show ? "" : "none";
}

async function refreshManagedMailboxActions() {
  try {
    const server = state.server || "";
    const query = server ? `?server=${encodeURIComponent(server)}` : "";
    const config = await api(`/mail/ebp-signup/config${query}`);
    managedMailDomain = config?.enabled && typeof config.domain === "string" ? config.domain : "";
  } catch {
    managedMailDomain = "";
  }
  syncManagedMailboxActions();
}

async function restoreEbpMailboxAccess() {
  const body = {
    identity: state.currentIdentity || undefined,
    server: state.server || undefined,
    accountId: state.selectedMailAccountId || undefined,
  };
  const result = await withIdentity(async () => api("/mail/ebp-reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  }), "Enter your identity password to restore mailbox access");
  await loadMailAccount();
  if (result?.savedLocally) {
    setStatus(`Restored mailbox access for ${result.email}`, "success");
  } else {
    setStatus(
      `Mailbox password reset for ${result?.email || "this account"}. Password: ${result?.password || ""}`,
      "success",
    );
  }
}

async function deleteEbpMailbox() {
  const email = (state.mailAccount?.fromEmail || "").trim();
  if (!email) {
    setStatus("Selected account has no from address", "error");
    return;
  }
  const typed = await requestTextInput(`Type ${email} to delete this mailbox`, email);
  if (!typed) return;
  const result = await withIdentity(async () => api("/mail/ebp-delete", {
    method: "POST",
    body: JSON.stringify({
      identity: state.currentIdentity || undefined,
      server: state.server || undefined,
      confirm: typed.trim(),
    }),
  }), "Enter your identity password to delete this mailbox");
  setStatus(`Deleted mailbox ${result?.email || email}`, "success");
  clearMailCache();
  await loadMailAccount();
  renderMailMessages();
  renderSelectedMailMessageBody();
}

export async function ensureMailPageUnlocked() {
  await loadMailAccount();
  return ensureMailSecretsUnlocked();
}

async function ensureMailSecretsUnlocked() {
  if (!(await ensureIdentityUnlocked())) return false;
  await loadMailAccount();
  if (!state.mailSecretsLocked || state.mailSecretsInMemory) return true;
  setStatus("Stored mail credentials could not be unlocked with the identity password", "error");
  return false;
}

export async function loadStoredMailCredentials() {
  try {
    const res = await api("/mail/accounts");
    state.settingsMailCredentials = res?.accounts || [];
    if (typeof res?.secretsInMemory === "boolean") state.mailSecretsInMemory = res.secretsInMemory;
    if (typeof res?.secretsLocked === "boolean") state.mailSecretsLocked = res.secretsLocked;
  } catch {
    state.settingsMailCredentials = [];
  }
}

export function renderStoredMailCredentials() {
  const list = document.getElementById("settings-mail-credentials-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.settingsMailCredentials.length) {
    list.innerHTML = "<li class='muted'>(no stored mail credentials)</li>";
    return;
  }
  for (const item of state.settingsMailCredentials) {
    const li = document.createElement("li");
    const lockedLabel = item.hasStoredSecret === null ? "locked (unlock identity)" : (item.hasStoredSecret ? "stored" : "not stored");
    const authLabel = "IMAP/SMTP";
    li.innerHTML = `
      <div class="server-identity-item">
        <div class="server-identity-info">
          <strong>${escapeHtml(item.name || item.id)}</strong>
          <div class="small muted">User: ${escapeHtml(item.username || "-")} • From: ${escapeHtml(item.fromEmail || "-")}</div>
          <div class="small muted">Auth: ${escapeHtml(authLabel)} • IMAP: ${escapeHtml(item.imapHost || "-")} • SMTP: ${escapeHtml(item.smtpHost || "-")} • Secrets: ${escapeHtml(lockedLabel)}</div>
        </div>
        <div class="server-identity-actions">
          <button class="danger btn-delete-mail-credential" data-account-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll(".btn-delete-mail-credential").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const accountId = btn.dataset.accountId;
      const target = state.settingsMailCredentials.find((entry) => entry.id === accountId);
      const label = target?.name || accountId;
      const { showConfirmModal } = await import("./modals.js");
      const confirmed = await showConfirmModal(
        "Delete Stored Mail Credential",
        `Delete stored mail credential "${label}" from this device?`,
        "Delete"
      );
      if (!confirmed) return;
      await withLoading(btn, async () => {
        try {
          const unlocked = await ensureMailSecretsUnlocked();
          if (!unlocked) return;
          await api("/mail/account/delete", {
            method: "POST",
            body: JSON.stringify({ accountId }),
          });
          setStatus(`Deleted stored mail credential "${label}"`, "success");
          await loadAll();
        } catch (err) {
          setStatus(err.message, "error");
        }
      });
    });
  });
}

function buildSandboxedEmailSrcDoc(html) {
  const csp = "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;";
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8" />',
    `<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    '<style>html,body{margin:0;padding:12px;font-family:system-ui,-apple-system,sans-serif;color:#111;line-height:1.4;word-break:break-word;}img{max-width:100%;height:auto;}pre{white-space:pre-wrap;overflow-wrap:anywhere;}table{max-width:100%;}</style>',
    "</head>",
    `<body>${html || ""}</body>`,
    "</html>",
  ].join("");
}

function setMailReaderPlaintext(text) {
  const bodyWrap = document.getElementById("mail-message-body-wrap");
  const bodyEl = document.getElementById("mail-message-body");
  const htmlWrap = document.getElementById("mail-message-html-wrap");
  const frame = document.getElementById("mail-message-html-frame");
  if (bodyWrap) bodyWrap.style.display = "";
  if (htmlWrap) htmlWrap.style.display = "none";
  if (bodyEl) bodyEl.value = text || "";
  if (frame) frame.removeAttribute("srcdoc");
}

function setMailReaderHtml(html) {
  const bodyWrap = document.getElementById("mail-message-body-wrap");
  const htmlWrap = document.getElementById("mail-message-html-wrap");
  const frame = document.getElementById("mail-message-html-frame");
  if (bodyWrap) bodyWrap.style.display = "none";
  if (htmlWrap) htmlWrap.style.display = "block";
  if (frame) frame.setAttribute("srcdoc", buildSandboxedEmailSrcDoc(html));
}

function formatMailRelativeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const deltaMs = Date.now() - date.getTime();
  const absMinutes = Math.floor(Math.abs(deltaMs) / 60000);
  const absHours = Math.floor(absMinutes / 60);
  const absDays = Math.floor(absHours / 24);
  if (absMinutes < 1) return "just now";
  if (absMinutes < 60) return `${absMinutes}m ago`;
  if (absHours < 24) return `${absHours}h ago`;
  if (absDays === 1) return "Yesterday";
  if (absDays < 7) return `${absDays}d ago`;
  return date.toLocaleDateString();
}

function formatMailSize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unitIdx = 0;
  while (size >= 1024 && unitIdx < units.length - 1) {
    size /= 1024;
    unitIdx += 1;
  }
  const rounded = size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2);
  return `${rounded.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1")} ${units[unitIdx]}`;
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const marker = "base64,";
      const idx = result.indexOf(marker);
      resolve(idx >= 0 ? result.slice(idx + marker.length) : result);
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file?.name || "unknown"}`));
    reader.readAsDataURL(file);
  });
}

function clearComposeAttachments() {
  state.mailComposeAttachments = [];
  const input = document.getElementById("mail-compose-attachments");
  if (input) input.value = "";
  renderComposeAttachments();
}

function renderComposeAttachments() {
  const list = document.getElementById("mail-compose-attachments-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.mailComposeAttachments.length) {
    list.innerHTML = "<li>(no attachments selected)</li>";
    return;
  }
  for (const file of state.mailComposeAttachments) {
    const li = document.createElement("li");
    li.textContent = `${file.name} (${formatMailSize(file.size)})`;
    list.appendChild(li);
  }
}

function renderMailReaderAttachments() {
  const wrap = document.getElementById("mail-reader-attachments-wrap");
  const list = document.getElementById("mail-reader-attachments");
  if (!wrap || !list) return;
  list.innerHTML = "";
  const detail = state.selectedMailMessage;
  if (!detail || !Array.isArray(detail.attachments) || detail.attachments.length === 0) {
    wrap.style.display = "none";
    return;
  }
  wrap.style.display = "";
  for (const attachment of detail.attachments) {
    const li = document.createElement("li");
    const index = Number.isInteger(attachment.index) ? attachment.index : -1;
    const key = String(index);
    const decrypted = state.decryptedMailAttachments[key] || null;
    const size = formatMailSize(attachment.size);
    const contentType = attachment.contentType || "application/octet-stream";
    const encryptedLabel = attachment.isEbpEncryptedAttachment ? " (EBP encrypted)" : "";
    li.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: center; gap: 8px;">
        <span>${escapeHtml(attachment.filename || "attachment")}${escapeHtml(encryptedLabel)}</span>
        <span class="small muted">${escapeHtml(size || contentType)}</span>
      </div>
    `;
    const actions = document.createElement("div");
    actions.className = "row";
    actions.style.gap = "8px";
    actions.style.marginTop = "4px";
    li.appendChild(actions);
    if (attachment.isEbpEncryptedAttachment) {
      const decryptBtn = document.createElement("button");
      decryptBtn.type = "button";
      decryptBtn.className = "secondary";
      decryptBtn.textContent = decrypted ? "Decrypt Again" : "Decrypt";
      decryptBtn.addEventListener("click", async () => {
        const scope = mailCacheScope();
        const requestId = state.mailMessageLoadRequestId;
        try {
          const folder = getSelectedMailFolder();
          const accountQ = state.selectedMailAccountId ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}` : "";
          const uid = state.selectedMailMessage?.uid;
          if (!Number.isInteger(uid) || uid <= 0) throw new Error("Selected message is missing uid");
          let payload = attachment.ebpPayload || null;
          if (!payload) {
            const detail = await api(`/mail/message/attachment?folder=${encodeURIComponent(folder)}&uid=${encodeURIComponent(String(uid))}&index=${encodeURIComponent(String(index))}${accountQ}`);
            if (scope !== mailCacheScope() || requestId !== state.mailMessageLoadRequestId) return;
            payload = detail?.ebpPayload || null;
            if (!payload) throw new Error("Attachment payload is unavailable");
            attachment.ebpPayload = payload;
            attachment.attachmentId = detail?.attachmentId || null;
          }
          const sender = document.getElementById("mail-sender-contact").value.trim();
          const res = await withIdentity(async () => api("/mail/decrypt-attachment", {
            method: "POST",
            body: JSON.stringify({
              payload,
              sender: sender || undefined,
              expectedBodyPayloadHash: state.selectedMailMessage?.ebpBodyPayloadHash || undefined,
              contentKey: state.selectedMailMessageContentKey || undefined,
              expectedAttachmentHash: (
                state.selectedMailMessageAttachmentManifest || []
              ).find((entry) => entry.attachmentId === payload?.attachmentId)?.ciphertextSha256 || undefined,
            }),
          }), "Enter password to decrypt encrypted attachment");
          if (scope !== mailCacheScope() || requestId !== state.mailMessageLoadRequestId) return;
          state.decryptedMailAttachments[key] = res;
          renderMailReaderAttachments();
          setStatus(`Attachment decrypted: ${res.fileName}`, "success");
        } catch (err) {
          if (isUnlockCancelled(err)) return;
          setStatus(err.message, "error");
        }
      });
      actions?.appendChild(decryptBtn);
      if (decrypted && decrypted.fileDataBase64 && decrypted.fileName) {
        const saveBtn = document.createElement("button");
        saveBtn.type = "button";
        saveBtn.className = "secondary";
        saveBtn.textContent = "Save";
        saveBtn.addEventListener("click", async () => {
          try {
            const out = await api("/save-file", {
              method: "POST",
              body: JSON.stringify({
                filename: decrypted.fileName,
                base64Content: decrypted.fileDataBase64,
              }),
            });
            setStatus(`Saved to ~/Downloads/${out.filename}`, "success");
          } catch (err) {
            setStatus(err.message, "error");
          }
        });
        actions?.appendChild(saveBtn);
      }
      const verifyBadge = document.createElement("span");
      verifyBadge.dataset.attachmentStatus = key;
      if (decrypted) {
        const verified = decrypted.verified ?? (decrypted.verifyStatus === "invalid" ? false : null);
        applyVerifyResultBadge(verifyBadge, verified, decrypted.verifyStatus || null);
      } else {
        verifyBadge.className = "result-badge pending";
        verifyBadge.textContent = "🔒 Encrypted";
      }
      actions?.appendChild(verifyBadge);
    } else {
      const meta = document.createElement("span");
      meta.className = "small muted";
      meta.textContent = "Not an EBP encrypted attachment";
      actions?.appendChild(meta);
    }
    list.appendChild(li);
  }
}

function renderMailReaderHeader() {
  const detail = state.selectedMailMessage;
  const subjectEl = document.getElementById("mail-reader-subject");
  const fromEl = document.getElementById("mail-reader-from");
  const toEl = document.getElementById("mail-reader-to");
  const dateEl = document.getElementById("mail-reader-date");
  const emptyEl = document.getElementById("mail-reader-empty");
  const hasDetail = Boolean(detail);
  if (emptyEl) emptyEl.style.display = hasDetail ? "none" : "block";
  if (!subjectEl || !fromEl || !toEl || !dateEl) return;
  if (!detail) {
    subjectEl.textContent = "(none selected)";
    fromEl.textContent = "-";
    toEl.textContent = "-";
    dateEl.textContent = "-";
    return;
  }
  const dateValue = detail.date ? new Date(detail.date).toLocaleString() : "-";
  subjectEl.textContent = detail.subject || "(no subject)";
  fromEl.textContent = detail.from || "(unknown sender)";
  toEl.textContent = detail.to || "(unknown recipient)";
  dateEl.textContent = dateValue;
}

function getSelectedMailPayload() {
  const detail = state.selectedMailMessage;
  if (!detail) return null;
  if (detail.ebpPayload && typeof detail.ebpPayload === "object") return detail.ebpPayload;
  return extractEbpPayloadFromText(detail.text || detail.html || "");
}

function isEncryptedMailPayload(payload) {
  return typeof payload?.type === "string" && payload.type.startsWith("ebp-encrypted");
}

function renderMailTechnicalDetails(payload) {
  const details = document.getElementById("mail-technical-details");
  if (!details) return;
  if (!payload) {
    const armorEl = document.getElementById("mail-technical-armor");
    if (armorEl) armorEl.value = "";
    details.style.display = "none";
    details.open = false;
    return;
  }
  details.style.display = "";
  const detail = state.selectedMailMessage || {};
  const rawText = typeof detail.text === "string" && detail.text.includes("-----BEGIN EBP")
    ? detail.text
    : JSON.stringify(payload, null, 2);
  const armorEl = document.getElementById("mail-technical-armor");
  if (armorEl) armorEl.value = rawText;
  const typeEl = document.getElementById("mail-technical-payload-type");
  if (typeEl) typeEl.textContent = payload.type || "unknown";
}

function setMailReaderLocked(locked) {
  const lockedEl = document.getElementById("mail-reader-locked");
  if (lockedEl) lockedEl.style.display = locked ? "" : "none";
  if (!locked) return;
  const bodyWrap = document.getElementById("mail-message-body-wrap");
  const htmlWrap = document.getElementById("mail-message-html-wrap");
  const bodyEl = document.getElementById("mail-message-body");
  const frame = document.getElementById("mail-message-html-frame");
  if (bodyWrap) bodyWrap.style.display = "none";
  if (htmlWrap) htmlWrap.style.display = "none";
  if (bodyEl) bodyEl.value = "";
  if (frame) frame.removeAttribute("srcdoc");
}

function renderSelectedMailMessageBody() {
  const detail = state.selectedMailMessage;
  renderMailReaderHeader();
  if (!detail) {
    setMailReaderLocked(false);
    renderMailTechnicalDetails(null);
    renderMailAuthenticityBadge(null);
    setMailReaderPlaintext("");
    renderMailReaderAttachments();
    return;
  }
  const payload = getSelectedMailPayload();
  const decryptResult = state.selectedMailDecryptResult;
  renderMailTechnicalDetails(payload);
  renderMailAuthenticityBadge(decryptResult);
  if (decryptResult) {
    setMailReaderLocked(false);
    setMailReaderPlaintext(decryptResult.message || "");
    renderMailReaderAttachments();
    return;
  }
  if (isEncryptedMailPayload(payload)) {
    setMailReaderLocked(true);
    renderMailReaderAttachments();
    return;
  }
  setMailReaderLocked(false);
  const textBody = typeof detail.text === "string" ? detail.text : "";
  const htmlBody = typeof detail.html === "string" ? detail.html : "";
  if (state.mailRenderHtml && htmlBody.trim()) {
    setMailReaderHtml(htmlBody);
    renderMailReaderAttachments();
    return;
  }
  setMailReaderPlaintext(textBody || htmlBody || "");
  renderMailReaderAttachments();
}

async function decryptSelectedMailMessage() {
  const detail = state.selectedMailMessage;
  const payload = getSelectedMailPayload();
  const scope = mailCacheScope();
  const requestId = state.mailMessageLoadRequestId;
  if (!detail || !payload) throw new Error("Selected message has no EBP payload");
  const sender = document.getElementById("mail-sender-contact")?.value.trim() || "";
  const res = await withIdentity(async () => api("/decrypt", {
    method: "POST",
    body: JSON.stringify({
      payload,
      sender: sender || undefined,
      messageFrom: detail.from || undefined,
    }),
  }), "Enter your identity password to decrypt this message");
  if (scope !== mailCacheScope() || requestId !== state.mailMessageLoadRequestId) return;
  state.selectedMailDecryptResult = res;
  state.selectedMailMessageContentKey = typeof res?.contentKey === "string" ? res.contentKey : null;
  state.selectedMailMessageAttachmentManifest = Array.isArray(res?.attachmentManifest)
    ? res.attachmentManifest
    : [];
  state.selectedMailMessageRecipientFingerprints = Array.isArray(res?.recipientFingerprints)
    ? res.recipientFingerprints
    : [];
  renderSelectedMailMessageBody();
  updateVerifyResult("mail-verify-result", res?.verified ?? null, res?.verifyStatus || null);
  renderMailVerifyMeta(res);
  if (res?.verifyStatus === "invalid" || res?.verifyStatus === "fingerprint_mismatch") {
    openMailAuthenticityModal(res);
  }
}

function setMailMessageLoading(loading) {
  state.mailMessageLoading = loading;
  const loadingEl = document.getElementById("mail-message-loading");
  if (loadingEl) loadingEl.style.display = loading ? "block" : "none";
}

function renderMailMessages() {
  const list = document.getElementById("mail-message-list");
  if (!list) return;
  list.innerHTML = "";
  if (!state.mailMessages.length) {
    const emptyText = isSentFolderView(getSelectedMailFolder())
      ? "(no sent messages)"
      : "(no messages)";
    list.innerHTML = `<li class='muted'>${emptyText}</li>`;
    return;
  }
  const selectedUid = state.selectedMailMessageUid != null
    ? String(state.selectedMailMessageUid)
    : (state.selectedMailMessage?.uid != null ? String(state.selectedMailMessage.uid) : null);
  for (const msg of state.mailMessages) {
    const li = document.createElement("li");
    const isSelected = selectedUid !== null && String(msg.uid) === selectedUid;
    const dateText = formatMailRelativeDate(msg.date);
    const sizeText = formatMailSize(msg.size);
    const sentView = isSentFolderView(getSelectedMailFolder());
    const who = sentView
      ? `To: ${msg.to || "(unknown recipient)"}`
      : (msg.from || "(unknown sender)");
    const fromMeta = [who, sizeText ? `Size: ${sizeText}` : ""].filter(Boolean).join(" • ");
    li.className = isSelected ? "clickable current mail-message-item" : "clickable mail-message-item";
    if (!msg.seen) li.classList.add("unread");
    li.innerHTML = `
      <div class="row" style="justify-content: space-between; align-items: center; gap: 8px;">
        <span class="mail-message-subject">${escapeHtml(msg.subject || "(no subject)")}</span>
        <span class="small muted mail-message-date">${escapeHtml(dateText)}</span>
      </div>
      <div class="small muted mail-message-from">${escapeHtml(fromMeta)}</div>
    `;
    li.addEventListener("click", async () => {
      cancelMailMessageRequest();
      const requestId = state.mailMessageLoadRequestId + 1;
      state.mailMessageLoadRequestId = requestId;
      state.selectedMailMessage = null;
      state.selectedMailDecryptResult = null;
      state.decryptedMailAttachments = {};
      state.selectedMailMessageContentKey = null;
      state.selectedMailMessageAttachmentManifest = [];
      state.selectedMailMessageRecipientFingerprints = [];
      state.selectedMailMessageUid = String(msg.uid);
      renderSelectedMailMessageBody();
      updateVerifyResult("mail-verify-result", null, null);
      renderMailVerifyMeta(null);
      const senderInput = document.getElementById("mail-sender-contact");
      if (senderInput) senderInput.value = "";
      setMailMessageLoading(true);
      renderMailMessages();
      try {
        const folder = getSelectedMailFolder();
        mailMessageAbortController = new AbortController();
        mailMessageAbortReason = "";
        mailMessageTimeoutId = setTimeout(() => {
          if (!mailMessageAbortController) return;
          mailMessageAbortReason = "timeout";
          mailMessageAbortController.abort("mail message load timeout");
        }, MAIL_MESSAGE_TIMEOUT_MS);
        const detail = await loadMailMessageDetail(folder, msg.uid, mailMessageAbortController.signal);
        if (requestId !== state.mailMessageLoadRequestId) return;
        if (mailMessageTimeoutId !== null) {
          clearTimeout(mailMessageTimeoutId);
          mailMessageTimeoutId = null;
        }
        mailMessageAbortController = null;
        mailMessageAbortReason = "";
        if (detail?._timing) {
          console.warn("mail/message timing", detail._timing);
        }
        if (requestId !== state.mailMessageLoadRequestId) return;
        state.selectedMailMessage = detail;
        state.selectedMailDecryptResult = null;
        state.decryptedMailAttachments = {};
        state.selectedMailMessageContentKey = null;
        state.selectedMailMessageAttachmentManifest = [];
        state.selectedMailMessageRecipientFingerprints = [];
        if (detail?.uid != null) state.selectedMailMessageUid = String(detail.uid);
        setMailMessageLoading(false);
        renderMailMessages();
        renderSelectedMailMessageBody();
        updateVerifyResult("mail-verify-result", null, null);
        renderMailVerifyMeta(null);
        autoFillSenderContact(detail);
        if (isEncryptedMailPayload(getSelectedMailPayload()) && isIdentityUnlocked()) {
          await decryptSelectedMailMessage();
        }
      } catch (err) {
        if (requestId !== state.mailMessageLoadRequestId) return;
        if (mailMessageTimeoutId !== null) {
          clearTimeout(mailMessageTimeoutId);
          mailMessageTimeoutId = null;
        }
        mailMessageAbortController = null;
        const abortReason = mailMessageAbortReason;
        mailMessageAbortReason = "";
        if (requestId !== state.mailMessageLoadRequestId) return;
        if (err?.message === "request aborted") {
          setMailMessageLoading(false);
          if (abortReason === "timeout") {
            setStatus("Loading message timed out, click again to retry", "error");
          }
          return;
        }
        setMailMessageLoading(false);
        if (isUnlockCancelled(err)) return;
        setStatus(err.message, "error");
      }
    });
    list.appendChild(li);
  }
}

export async function openMailMessage(folder, uid) {
  const presets = ["INBOX", "Sent", "Drafts", "Trash", "Spam"];
  const folderEl = document.getElementById("mail-folder");
  const customEl = document.getElementById("mail-folder-custom");
  if (folderEl) {
    if (presets.includes(folder)) {
      folderEl.value = folder;
    } else {
      folderEl.value = "__custom__";
      if (customEl) customEl.value = folder;
    }
    syncMailFolderCustomUi();
  }
  setMailTab("inbox");
  cancelMailMessageRequest();
  const requestId = state.mailMessageLoadRequestId + 1;
  state.mailMessageLoadRequestId = requestId;
  state.selectedMailMessage = null;
  state.selectedMailDecryptResult = null;
  state.decryptedMailAttachments = {};
  state.selectedMailMessageContentKey = null;
  state.selectedMailMessageAttachmentManifest = [];
  state.selectedMailMessageRecipientFingerprints = [];
  state.selectedMailMessageUid = String(uid);
  renderSelectedMailMessageBody();
  setMailMessageLoading(true);
  try {
    mailMessageAbortController = new AbortController();
    const detail = await loadMailMessageDetail(folder, uid, mailMessageAbortController.signal);
    if (requestId !== state.mailMessageLoadRequestId) return;
    state.selectedMailMessage = detail;
    if (detail?.uid != null) state.selectedMailMessageUid = String(detail.uid);
    setMailMessageLoading(false);
    renderSelectedMailMessageBody();
    autoFillSenderContact(detail);
    if (isEncryptedMailPayload(getSelectedMailPayload()) && isIdentityUnlocked()) {
      await decryptSelectedMailMessage();
    }
  } catch (err) {
    if (requestId !== state.mailMessageLoadRequestId) return;
    setMailMessageLoading(false);
    if (isUnlockCancelled(err)) return;
    setStatus(err.message, "error");
  }
}

function applyMailPage(res, folder, page) {
  state.mailMessages = res?.messages || [];
  const heading = document.getElementById("mail-list-heading");
  if (heading) {
    heading.textContent = isSentFolderView(folder) ? "Sent" : (folder === "INBOX" ? "Inbox" : folder);
  }
  if (res?.pagination) {
    state.mailPagination = {
      page: res.pagination.page ?? page,
      totalPages: res.pagination.totalPages ?? 1,
      total: res.pagination.total ?? state.mailMessages.length,
    };
  } else {
    state.mailPagination = { page: 1, totalPages: 1, total: state.mailMessages.length };
  }
  renderMailMessages();
  renderMailPagination();
}

export async function loadMailMessages(page = 1, { refresh = false } = {}) {
  cancelMailMessageRequest();
  state.mailMessageLoadRequestId += 1;
  setMailMessageLoading(false);
  mailListAbortController?.abort();
  const controller = new AbortController();
  mailListAbortController = controller;
  const requestId = ++mailListRequestId;
  const scope = mailCacheScope();
  const folder = getSelectedMailFolder();
  const limit = Number(document.getElementById("mail-limit").value || 20);
  const searchRaw = (document.getElementById("mail-search")?.value ?? "").trim();
  if (folder !== mailListFolder) {
    resetMailReader();
    renderSelectedMailMessageBody();
    updateVerifyResult("mail-verify-result", null, null);
    renderMailVerifyMeta(null);
    mailListFolder = folder;
  }
  if (refresh) mailBodyCache.clear();
  const key = JSON.stringify([scope, folder, limit, searchRaw, page]);
  const cached = mailPageCache.get(key);
  // Render cached (including empty) pages before the refresh request completes.
  applyMailPage(cached || { messages: [] }, folder, page);
  const accountQ = state.selectedMailAccountId ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}` : "";
  const searchQ = searchRaw ? `&search=${encodeURIComponent(searchRaw)}` : "";
  try {
    const res = await api(`/mail/messages?folder=${encodeURIComponent(folder)}&limit=${encodeURIComponent(String(limit))}${accountQ}${searchQ}&page=${encodeURIComponent(String(page))}`, { signal: controller.signal });
    if (requestId !== mailListRequestId || scope !== mailCacheScope()) return;
    mailPageCache.set(key, res);
    applyMailPage(res, folder, page);
    if (res?._timing) console.warn("mail/messages timing", res._timing);
  } catch (err) {
    if (requestId !== mailListRequestId || controller.signal.aborted || scope !== mailCacheScope()) return;
    // Keep the cached page visible on refresh failure, but report the error.
    throw err;
  } finally {
    if (requestId === mailListRequestId) mailListAbortController = null;
  }
}

function renderMailPagination() {
  const container = document.getElementById("mail-pagination");
  const pageInfo = document.getElementById("mail-page-info");
  const prevBtn = document.getElementById("mail-prev");
  const nextBtn = document.getElementById("mail-next");
  if (!container) return;

  const { page, totalPages, total } = state.mailPagination;

  if (total === 0) {
    container.style.display = "none";
    return;
  }

  container.style.display = "flex";

  if (totalPages <= 1) {
    pageInfo.textContent = `${total} ${total === 1 ? "message" : "messages"}`;
  } else {
    pageInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  }

  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
}

function selectMailboxFolder(folder) {
  const folderEl = document.getElementById("mail-folder");
  const customEl = document.getElementById("mail-folder-custom");
  const presets = ["INBOX", "Sent", "Drafts", "Trash", "Spam"];
  if (folderEl) {
    if (presets.includes(folder)) {
      folderEl.value = folder;
      if (customEl) customEl.value = "";
    } else {
      folderEl.value = "__custom__";
      if (customEl) customEl.value = folder;
    }
  }
  syncMailFolderCustomUi();
  if (state.mailActiveTab === "inbox" || state.mailActiveTab === "sent" || !state.mailActiveTab) {
    setMailTab(isSentFolderView(folder) ? "sent" : "inbox");
  }
}

async function showMailboxFolder(folder) {
  selectMailboxFolder(folder);
  setMailTab(isSentFolderView(folder) ? "sent" : "inbox");
  await loadMailMessages(1);
}

export function initMailPage() {
  initMailTabs();
  renderMailReaderHeader();
  syncMailFolderCustomUi();

  document.querySelectorAll('[data-mail-tab="inbox"], [data-mail-tab="sent"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      const folder = btn.dataset.mailTab === "sent" ? "Sent" : "INBOX";
      selectMailboxFolder(folder);
      loadMailMessages(1).catch((err) => setStatus(err.message, "error"));
    });
  });

  const folderEl = document.getElementById("mail-folder");
  if (folderEl) {
    folderEl.addEventListener("change", () => {
      cancelMailMessageRequest();
      syncMailFolderCustomUi();
      const folder = getSelectedMailFolder();
      if (state.mailActiveTab === "inbox" || state.mailActiveTab === "sent") {
        setMailTab(isSentFolderView(folder) ? "sent" : "inbox");
      }
      loadMailMessages(1).catch((err) => setStatus(err.message, "error"));
    });
  }

  const includePublicKeysToggle = document.getElementById("settings-mail-include-public-keys");
  if (includePublicKeysToggle) {
    includePublicKeysToggle.checked = Boolean(state.mailIncludePublicKeys);
    includePublicKeysToggle.addEventListener("change", () => {
      state.mailIncludePublicKeys = includePublicKeysToggle.checked;
      saveBooleanPreference(MAIL_INCLUDE_PUBLIC_KEYS_PREF_KEY, state.mailIncludePublicKeys);
    });
  }

  const renderHtmlToggle = document.getElementById("settings-mail-render-html");
  if (renderHtmlToggle) {
    renderHtmlToggle.checked = Boolean(state.mailRenderHtml);
    renderHtmlToggle.addEventListener("change", () => {
      state.mailRenderHtml = renderHtmlToggle.checked;
      saveBooleanPreference(MAIL_RENDER_HTML_PREF_KEY, state.mailRenderHtml);
      renderSelectedMailMessageBody();
    });
  }

  const accountSelect = document.getElementById("mail-account-select");
  if (accountSelect) {
    accountSelect.addEventListener("change", async () => {
      const accountId = accountSelect.value || "";
      if (!accountId) return;
      try {
        await api("/mail/account/select", {
          method: "POST",
          body: JSON.stringify({ accountId }),
        });
        state.mailCreatingNewAccount = false;
        await loadMailAccount();
        state.mailMessages = [];
        state.selectedMailMessage = null;
        state.selectedMailMessageUid = null;
        state.selectedMailDecryptResult = null;
        state.decryptedMailAttachments = {};
        cancelMailMessageRequest();
        state.mailMessageLoadRequestId += 1;
        setMailMessageLoading(false);
        renderMailMessages();
        renderSelectedMailMessageBody();
        updateVerifyResult("mail-verify-result", null, null);
        await loadMailMessages(1);
        setStatus("Mail account selected", "success");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  }

  const newAccountBtn = document.getElementById("mail-account-new");
  if (newAccountBtn) {
    newAccountBtn.addEventListener("click", () => {
      setMailTab("account");
      clearMailCache();
      state.selectedMailAccountId = null;
      state.mailCreatingNewAccount = true;
      if (accountSelect) accountSelect.value = "";
      document.getElementById("mail-account-name").value = "";
      document.getElementById("mail-imap-host").value = "";
      document.getElementById("mail-imap-port").value = "993";
      document.getElementById("mail-imap-secure").checked = true;
      document.getElementById("mail-smtp-host").value = "";
      document.getElementById("mail-smtp-port").value = "465";
      document.getElementById("mail-smtp-secure").checked = true;
      document.getElementById("mail-username").value = "";
      document.getElementById("mail-from-email").value = "";
      document.getElementById("mail-from-name").value = "";
      document.getElementById("mail-imap-password").value = "";
      document.getElementById("mail-smtp-password").value = "";
      clearComposeAttachments();
      syncManagedMailboxActions();
      setStatus("Creating new mail account profile", "success");
    });
  }

  const mailAccountForm = document.getElementById("mail-account-form");
  if (mailAccountForm) {
    mailAccountForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          const fromEmail = document.getElementById("mail-from-email").value.trim();
          const account = {
            authType: "password",
            imapHost: document.getElementById("mail-imap-host").value.trim(),
            imapPort: Number(document.getElementById("mail-imap-port").value || 993),
            imapSecure: document.getElementById("mail-imap-secure").checked,
            smtpHost: document.getElementById("mail-smtp-host").value.trim(),
            smtpPort: Number(document.getElementById("mail-smtp-port").value || 465),
            smtpSecure: document.getElementById("mail-smtp-secure").checked,
            username: document.getElementById("mail-username").value.trim(),
            fromEmail,
            fromName: document.getElementById("mail-from-name").value.trim(),
            persistSecrets: document.getElementById("mail-persist-secrets").checked,
          };
          const imapPassword = document.getElementById("mail-imap-password").value;
          const smtpPassword = document.getElementById("mail-smtp-password").value;
          const accountName = document.getElementById("mail-account-name").value.trim();
          if (!(await ensureMailSecretsUnlocked())) return;
          await api("/mail/account", {
            method: "POST",
            body: JSON.stringify({
              accountId: state.selectedMailAccountId || undefined,
              createNew: state.mailCreatingNewAccount,
              accountName: accountName || undefined,
              account,
              imapPassword: imapPassword || undefined,
              smtpPassword: smtpPassword || undefined,
            }),
          });
          clearMailCache();
          setStatus("Mail account saved", "success");
          document.getElementById("mail-imap-password").value = "";
          document.getElementById("mail-smtp-password").value = "";
          await loadMailAccount();
        } catch (err) {
          setStatus(err.message, "error");
        }
      });
    });
  }

  const testBtn = document.getElementById("mail-test-btn");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      await withLoading(testBtn, async () => {
        try {
          await api("/mail/test", {
            method: "POST",
            body: JSON.stringify({ accountId: state.selectedMailAccountId || undefined }),
          });
          setStatus("Mail connection test passed", "success");
        } catch (err) {
          setStatus(err.message, "error");
        }
      });
    });
  }

  const restoreMailboxBtn = document.getElementById("mail-ebp-restore-btn");
  if (restoreMailboxBtn) {
    restoreMailboxBtn.addEventListener("click", async () => {
      await withLoading(restoreMailboxBtn, async () => {
        try {
          await restoreEbpMailboxAccess();
        } catch (err) {
          if (isUnlockCancelled(err)) return;
          setStatus(err.message, "error");
        }
      });
    });
  }

  const deleteMailboxBtn = document.getElementById("mail-ebp-delete-btn");
  if (deleteMailboxBtn) {
    deleteMailboxBtn.addEventListener("click", async () => {
      await withLoading(deleteMailboxBtn, async () => {
        try {
          await deleteEbpMailbox();
        } catch (err) {
          if (isUnlockCancelled(err)) return;
          setStatus(err.message, "error");
        }
      });
    });
  }

  const inboxForm = document.getElementById("mail-inbox-form");
  if (inboxForm) {
    inboxForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          await loadMailMessages(1, { refresh: true });
          setStatus("Inbox refreshed", "success");
        } catch (err) {
          setStatus(err.message, "error");
        }
      });
    });
  }

  const mailPrevBtn = document.getElementById("mail-prev");
  if (mailPrevBtn) {
    mailPrevBtn.addEventListener("click", async () => {
      const { page } = state.mailPagination;
      if (page <= 1) return;
      try {
        setStatus("Loading...");
        await loadMailMessages(page - 1);
        setStatus("Ready", "success");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  }

  const mailNextBtn = document.getElementById("mail-next");
  if (mailNextBtn) {
    mailNextBtn.addEventListener("click", async () => {
      const { page, totalPages } = state.mailPagination;
      if (page >= totalPages) return;
      try {
        setStatus("Loading...");
        await loadMailMessages(page + 1);
        setStatus("Ready", "success");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  }

  initMailAuthenticityModal();
  for (const id of ["mail-decrypt-btn", "mail-redecrypt-btn"]) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener("click", async () => {
      await withLoading(btn, async () => {
        try {
          await decryptSelectedMailMessage();
        } catch (err) {
          if (isUnlockCancelled(err)) return;
          setStatus(err.message, "error");
        }
      });
    });
  }

  const replyBtn = document.getElementById("mail-reply-btn");
  if (replyBtn) {
    replyBtn.addEventListener("click", () => {
      if (!state.selectedMailMessage) {
        setStatus("Select a message first", "error");
        return;
      }
      const fromAddress = extractEmailAddress(state.selectedMailMessage.from || "");
      const subject = (state.selectedMailMessage.subject || "").trim();
      const composeSubject = document.getElementById("mail-compose-subject");
      const composeBody = document.getElementById("mail-compose-body");
      setComposeChips(fromAddress ? [{ email: fromAddress }] : []);
      if (composeSubject) composeSubject.value = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject || "(no subject)"}`;
      setMailTab("compose");
      composeBody?.focus();
      setStatus("Reply drafted from selected message", "success");
    });
  }

  const composeForm = document.getElementById("mail-compose-form");
  if (composeForm) {
    const attachmentsEl = document.getElementById("mail-compose-attachments");
    if (attachmentsEl) {
      attachmentsEl.addEventListener("change", () => {
        state.mailComposeAttachments = Array.from(attachmentsEl.files || []);
        renderComposeAttachments();
      });
    }
    initComposeRecipients({ onChange: () => updateMailComposeSendState() });
    updateMailComposeSendState();
    renderComposeAttachments();

    composeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          const chips = getComposeChips();
          const intent = deriveComposeIntent(chips);
          const to = chips.map((chip) => chip.email).join(", ");
          const subject = document.getElementById("mail-compose-subject").value.trim();
          const body = document.getElementById("mail-compose-body").value;
          if (intent.kind === "empty") throw new Error("Add at least one recipient");
          if (intent.kind === "blocked") throw new Error(intent.message);
          if (!subject) throw new Error("Subject is required");
          const attachments = await Promise.all(
            state.mailComposeAttachments.map(async (file) => ({
              fileName: file.name || "attachment.bin",
              mimeType: file.type || "application/octet-stream",
              fileDataBase64: await readFileAsBase64(file),
            })),
          );

          let sentResult;
          if (intent.kind === "encrypted") {
            const recipients = chips.map((chip) => ({ contact: chip.contact, email: chip.email }));
            sentResult = await withIdentity(async () => api("/mail/send-ebp", {
              method: "POST",
              body: JSON.stringify({
                accountId: state.selectedMailAccountId || undefined,
                subject,
                message: body,
                recipients,
                includePublicKeys: state.mailIncludePublicKeys,
                attachments,
              }),
            }), "Enter password to sign/encrypt this email and attachments");
          } else {
            sentResult = await api("/mail/send", {
              method: "POST",
              body: JSON.stringify({
                accountId: state.selectedMailAccountId || undefined,
                to,
                subject,
                text: body,
                attachments,
              }),
            });
          }
          const savedToSent = sentResult?.savedToSent !== false;
          document.getElementById("mail-compose-subject").value = "";
          document.getElementById("mail-compose-body").value = "";
          setComposeChips([]);
          clearComposeAttachments();
          if (savedToSent) {
            try {
              await showMailboxFolder("Sent");
            } catch (err) {
              setStatus(`Email sent, but Sent could not be opened: ${err.message}`, "error");
              return;
            }
          }
          setStatus(
            savedToSent
              ? "Email sent. It's in Sent."
              : "Email sent, but a copy could not be saved to Sent",
            savedToSent ? "success" : "error",
          );
        } catch (err) {
          if (isUnlockCancelled(err)) return;
          setStatus(err.message, "error");
        }
      });
      updateMailComposeSendState();
    });
  }
}
