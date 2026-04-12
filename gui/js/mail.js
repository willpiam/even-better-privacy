import { state, saveBooleanPreference, MAIL_RENDER_HTML_PREF_KEY, MAIL_INCLUDE_PUBLIC_KEYS_PREF_KEY, LOCAL_BACKEND_ORIGIN } from "./state.js";
import { api, setStatus, setButtonLoading, withLoading, escapeHtml } from "./ui.js";
import { requestPassword } from "./modals.js";
import { updateMailComposeSendState, setMailTab, initMailTabs, syncMailFolderCustomUi, getSelectedMailFolder } from "./contact-search.js";
import { updateVerifyResult, autoFillSenderContact, extractEbpPayloadFromText, extractEmailAddress, renderMailVerifyMeta, loadAll } from "./render.js";

export async function loadMailAccount() {
  try {
    const res = await api("/mail/account");
    state.mailAccounts = res?.accounts || [];
    state.selectedMailAccountId = res?.selectedAccountId || res?.accountId || null;
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
      const authTypeEl = document.getElementById("mail-auth-type");
      if (authTypeEl) authTypeEl.value = "oauth";
      state.mailOAuthProvider = "";
      state.mailOAuthEmail = "";
      const providerInput = document.getElementById("mail-oauth-provider");
      const emailInput = document.getElementById("mail-oauth-email");
      if (providerInput) providerInput.value = "";
      if (emailInput) emailInput.value = "";
      const oauthStatus = document.getElementById("mail-oauth-status");
      if (oauthStatus) oauthStatus.textContent = "Choose a provider to connect this account.";
      applyMailAuthTypeUi();
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
    const authType = state.mailAccount.authType || "password";
    const authTypeEl = document.getElementById("mail-auth-type");
    if (authTypeEl) authTypeEl.value = authType;
    state.mailOAuthProvider = state.mailAccount.oauthProvider || "";
    state.mailOAuthEmail = state.mailAccount.fromEmail || "";
    const providerInput = document.getElementById("mail-oauth-provider");
    const emailInput = document.getElementById("mail-oauth-email");
    if (providerInput) providerInput.value = state.mailOAuthProvider || "";
    if (emailInput) emailInput.value = state.mailOAuthEmail || "";
    const oauthStatus = document.getElementById("mail-oauth-status");
    if (oauthStatus) {
      oauthStatus.textContent = authType === "oauth" && state.mailOAuthEmail
        ? `Connected as ${state.mailOAuthEmail}`
        : "Choose a provider to connect this account.";
    }
    applyMailAuthTypeUi();
  } catch (err) {
    console.warn("Could not load mail account", err);
  }
}

function applyMailAuthTypeUi() {
  const authType = document.getElementById("mail-auth-type")?.value || "oauth";
  const oauthWrap = document.getElementById("mail-oauth-fields");
  const manualWrap = document.getElementById("mail-manual-fields");
  const reauthBtn = document.getElementById("mail-oauth-reauth-btn");
  if (oauthWrap) oauthWrap.style.display = authType === "oauth" ? "" : "none";
  if (manualWrap) manualWrap.style.display = authType === "password" ? "" : "none";
  if (reauthBtn) {
    const showReauth = authType === "oauth" && Boolean(state.mailAccount && state.mailAccount.authType === "oauth");
    reauthBtn.style.display = showReauth ? "" : "none";
  }
}

async function beginMailOAuth(provider) {
  const oauthStatus = document.getElementById("mail-oauth-status");
  try {
    const start = await api("/mail/oauth/start", {
      method: "POST",
      body: JSON.stringify({ provider }),
    });
    state.mailOAuthPendingState = start.oauthState || "";

    const isWindows = /Win/.test(navigator.platform ?? "");
    let browserOpened = false;
    try {
      if (!isWindows && window.__TAURI__ && window.__TAURI__.shell && window.__TAURI__.shell.open) {
        await window.__TAURI__.shell.open(start.authUrl);
        browserOpened = true;
      }
    } catch { /* Tauri shell API not available */ }

    if (!browserOpened) {
      try {
        await api("/mail/oauth/open-browser", {
          method: "POST",
          body: JSON.stringify({ url: start.authUrl }),
        });
        browserOpened = true;
      } catch { /* backend opener failed */ }
    }

    if (oauthStatus) {
      oauthStatus.innerHTML = "";
      const statusMsg = document.createElement("div");
      statusMsg.style.marginBottom = "8px";
      if (browserOpened) {
        statusMsg.textContent = `Sign-in page should have opened in your browser. If not, copy the URL below and open it manually:`;
      } else {
        statusMsg.textContent = `Open this URL in your browser to sign in with ${provider}:`;
      }
      const urlBox = document.createElement("input");
      urlBox.type = "text";
      urlBox.readOnly = true;
      urlBox.value = start.authUrl;
      urlBox.style.width = "100%";
      urlBox.style.fontFamily = "monospace";
      urlBox.style.fontSize = "0.8em";
      urlBox.style.padding = "6px";
      urlBox.style.boxSizing = "border-box";
      urlBox.addEventListener("click", () => { urlBox.select(); });
      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.textContent = "Copy URL";
      copyBtn.className = "secondary";
      copyBtn.style.marginTop = "6px";
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(start.authUrl).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy URL"; }, 2000);
        }).catch(() => {
          urlBox.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy URL"; }, 2000);
        });
      });
      const waitMsg = document.createElement("div");
      waitMsg.className = "small muted";
      waitMsg.style.marginTop = "8px";
      waitMsg.textContent = "Waiting for sign-in to complete... (this page will update automatically)";
      oauthStatus.appendChild(statusMsg);
      oauthStatus.appendChild(urlBox);
      oauthStatus.appendChild(copyBtn);
      oauthStatus.appendChild(waitMsg);
    }

    pollMailOAuthCompletion(start.oauthState, provider);
  } catch (err) {
    if (oauthStatus) oauthStatus.textContent = err.message || "OAuth start failed";
    throw err;
  }
}

function pollMailOAuthCompletion(oauthState, provider, intervalMs = 2000, timeoutMs = 300000) {
  const oauthStatus = document.getElementById("mail-oauth-status");
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (Date.now() - startedAt > timeoutMs) {
      clearInterval(timer);
      if (oauthStatus) oauthStatus.textContent = "OAuth sign-in timed out. Please try again.";
      return;
    }
    try {
      const res = await api(`/mail/oauth/poll?state=${encodeURIComponent(oauthState)}`);
      if (res && res.status === "complete") {
        clearInterval(timer);
        await completeMailOAuth(res);
      }
    } catch {
      // Ignore transient poll errors
    }
  }, intervalMs);
}

async function completeMailOAuth(eventData) {
  if (!eventData || eventData.type !== "ebp-mail-oauth-complete") return;
  const oauthStatus = document.getElementById("mail-oauth-status");
  try {
    const oauthState = eventData.oauthState || "";
    if (!oauthState) throw new Error("OAuth callback did not include state");
    const accountName = document.getElementById("mail-account-name").value.trim();
    const pinNeeded = !state.mailSecretsInMemory;
    let pin;
    if (pinNeeded) {
      pin = await requestPassword("Set or enter email PIN (used to encrypt OAuth tokens at rest)");
      if (!pin) throw new Error("Email PIN is required to persist OAuth tokens");
    }
    await api("/mail/oauth/complete", {
      method: "POST",
      body: JSON.stringify({
        oauthState,
        accountId: state.selectedMailAccountId || undefined,
        createNew: state.mailCreatingNewAccount,
        accountName: accountName || undefined,
        pin: pin || undefined,
      }),
    });
    if (oauthStatus) oauthStatus.textContent = `Connected as ${eventData.email || ""}`;
    state.mailOAuthProvider = eventData.provider || "";
    state.mailOAuthEmail = eventData.email || "";
    const providerInput = document.getElementById("mail-oauth-provider");
    const emailInput = document.getElementById("mail-oauth-email");
    const fromEmailInput = document.getElementById("mail-from-email");
    if (providerInput) providerInput.value = state.mailOAuthProvider;
    if (emailInput) emailInput.value = state.mailOAuthEmail;
    if (fromEmailInput) fromEmailInput.value = state.mailOAuthEmail;
    document.getElementById("mail-auth-type").value = "oauth";
    applyMailAuthTypeUi();
    await loadMailAccount();
    await loadStoredMailCredentials();
    renderStoredMailCredentials();
    setStatus("OAuth account connected", "success");
  } catch (err) {
    if (oauthStatus) oauthStatus.textContent = err.message || "OAuth completion failed";
    setStatus(err.message, "error");
  }
}

export async function ensureMailPageUnlocked() {
  await loadMailAccount();
  return ensureMailSecretsUnlocked("Enter email PIN to unlock stored IMAP/SMTP passwords");
}

async function ensureMailSecretsUnlocked(promptText) {
  if (!state.mailSecretsLocked || state.mailSecretsInMemory) return true;
  const pin = await requestPassword(promptText);
  if (!pin) {
    setStatus("Email PIN is required", "error");
    return false;
  }
  try {
    await api("/mail/unlock", {
      method: "POST",
      body: JSON.stringify({ pin }),
    });
    await loadMailAccount();
    setStatus("Mail passwords unlocked for this session", "success");
    return true;
  } catch (err) {
    setStatus(err.message, "error");
    return false;
  }
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
    const lockedLabel = item.hasStoredSecret === null ? "locked (PIN required)" : (item.hasStoredSecret ? "stored" : "not stored");
    const authLabel = item.authType === "oauth"
      ? `OAuth (${item.oauthProvider || "provider"})`
      : "Manual IMAP/SMTP";
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
          const unlocked = await ensureMailSecretsUnlocked("Enter email PIN to manage stored mail credentials");
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

function renderSelectedMailMessageBody() {
  const detail = state.selectedMailMessage;
  renderMailReaderHeader();
  if (!detail) {
    setMailReaderPlaintext("");
    return;
  }
  const textBody = typeof detail.text === "string" ? detail.text : "";
  const htmlBody = typeof detail.html === "string" ? detail.html : "";
  if (state.mailRenderHtml && htmlBody.trim()) {
    setMailReaderHtml(htmlBody);
    return;
  }
  setMailReaderPlaintext(textBody || htmlBody || "");
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
    list.innerHTML = "<li class='muted'>(no messages)</li>";
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
    const fromMeta = [msg.from || "(unknown sender)", sizeText ? `Size: ${sizeText}` : ""].filter(Boolean).join(" • ");
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
      const requestId = state.mailMessageLoadRequestId + 1;
      state.mailMessageLoadRequestId = requestId;
      state.selectedMailMessage = null;
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
        const accountQ = state.selectedMailAccountId ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}` : "";
        const detail = await api(`/mail/message?folder=${encodeURIComponent(folder)}&uid=${encodeURIComponent(String(msg.uid))}${accountQ}`);
        if (requestId !== state.mailMessageLoadRequestId) return;
        state.selectedMailMessage = detail;
        if (detail?.uid != null) state.selectedMailMessageUid = String(detail.uid);
        setMailMessageLoading(false);
        renderMailMessages();
        renderSelectedMailMessageBody();
        updateVerifyResult("mail-verify-result", null, null);
        renderMailVerifyMeta(null);
        autoFillSenderContact(detail);
      } catch (err) {
        if (requestId !== state.mailMessageLoadRequestId) return;
        setMailMessageLoading(false);
        setStatus(err.message, "error");
      }
    });
    list.appendChild(li);
  }
}

export async function loadMailMessages(page = 1) {
  const folder = getSelectedMailFolder();
  const limit = Number(document.getElementById("mail-limit").value || 20);
  const searchRaw = (document.getElementById("mail-search")?.value ?? "").trim();
  const accountQ = state.selectedMailAccountId ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}` : "";
  const searchQ = searchRaw ? `&search=${encodeURIComponent(searchRaw)}` : "";
  const pageQ = `&page=${encodeURIComponent(String(page))}`;
  const res = await api(`/mail/messages?folder=${encodeURIComponent(folder)}&limit=${encodeURIComponent(String(limit))}${accountQ}${searchQ}${pageQ}`);
  state.mailMessages = res?.messages || [];
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

export function initMailPage() {
  initMailTabs();
  renderMailReaderHeader();
  syncMailFolderCustomUi();

  const folderEl = document.getElementById("mail-folder");
  if (folderEl) {
    folderEl.addEventListener("change", () => {
      syncMailFolderCustomUi();
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

  const authTypeToggle = document.getElementById("mail-auth-type");
  if (authTypeToggle) {
    authTypeToggle.addEventListener("change", () => {
      applyMailAuthTypeUi();
    });
  }
  const oauthGmailBtn = document.getElementById("mail-oauth-gmail-btn");
  if (oauthGmailBtn) {
    oauthGmailBtn.addEventListener("click", async () => {
      await withLoading(oauthGmailBtn, async () => {
        await beginMailOAuth("gmail");
      });
    });
  }
  const oauthReauthBtn = document.getElementById("mail-oauth-reauth-btn");
  if (oauthReauthBtn) {
    oauthReauthBtn.addEventListener("click", async () => {
      const provider = (state.mailAccount?.oauthProvider || state.mailOAuthProvider || "").trim();
      if (!provider) {
        setStatus("No OAuth provider is set for this account", "error");
        return;
      }
      await withLoading(oauthReauthBtn, async () => {
        await beginMailOAuth(provider);
      });
    });
  }
  window.addEventListener("message", async (event) => {
    const isLocalBackendOrigin = event.origin === LOCAL_BACKEND_ORIGIN;
    const isSameOrigin = event.origin === window.location.origin;
    if (!isLocalBackendOrigin && !isSameOrigin) return;
    if (!event.data || event.data.type !== "ebp-mail-oauth-complete") return;
    await completeMailOAuth(event.data);
  });

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
      document.getElementById("mail-auth-type").value = "oauth";
      document.getElementById("mail-oauth-provider").value = "";
      document.getElementById("mail-oauth-email").value = "";
      const oauthStatus = document.getElementById("mail-oauth-status");
      if (oauthStatus) oauthStatus.textContent = "Choose a provider to connect this account.";
      state.mailOAuthProvider = "";
      state.mailOAuthEmail = "";
      applyMailAuthTypeUi();
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
          const authType = document.getElementById("mail-auth-type").value || "oauth";
          const fromEmail = document.getElementById("mail-from-email").value.trim();
          const account = {
            gmailMode: false,
            authType,
            oauthProvider: authType === "oauth" ? (state.mailOAuthProvider || state.mailAccount?.oauthProvider || "") : "",
            imapHost: document.getElementById("mail-imap-host").value.trim(),
            imapPort: Number(document.getElementById("mail-imap-port").value || 993),
            imapSecure: document.getElementById("mail-imap-secure").checked,
            smtpHost: document.getElementById("mail-smtp-host").value.trim(),
            smtpPort: Number(document.getElementById("mail-smtp-port").value || 465),
            smtpSecure: document.getElementById("mail-smtp-secure").checked,
            username: authType === "oauth"
              ? (state.mailOAuthEmail || fromEmail || state.mailAccount?.username || "")
              : document.getElementById("mail-username").value.trim(),
            fromEmail,
            fromName: document.getElementById("mail-from-name").value.trim(),
            persistSecrets: document.getElementById("mail-persist-secrets").checked,
          };
          const imapPassword = document.getElementById("mail-imap-password").value;
          const smtpPassword = document.getElementById("mail-smtp-password").value;
          const accountName = document.getElementById("mail-account-name").value.trim();
          if (authType === "oauth") {
            if (!account.oauthProvider || !account.username || !fromEmail) {
              throw new Error("Complete OAuth sign-in before saving this account");
            }
          }
          let pin;
          if (account.persistSecrets && !state.mailSecretsInMemory) {
            pin = await requestPassword("Set or enter email PIN (used to encrypt mail passwords at rest)");
            if (!pin) {
              setStatus("Email PIN is required to persist encrypted mail passwords", "error");
              return;
            }
          }
          await api("/mail/account", {
            method: "POST",
            body: JSON.stringify({
              accountId: state.selectedMailAccountId || undefined,
              createNew: state.mailCreatingNewAccount,
              accountName: accountName || undefined,
              account,
              imapPassword: imapPassword || undefined,
              smtpPassword: smtpPassword || undefined,
              pin: pin || undefined,
            }),
          });
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
    testBtn.addEventListener("click", async (e) => {
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

  const inboxForm = document.getElementById("mail-inbox-form");
  if (inboxForm) {
    inboxForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          await loadMailMessages(1);
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

  const decryptBtn = document.getElementById("mail-decrypt-btn");
  if (decryptBtn) {
    decryptBtn.addEventListener("click", async () => {
      try {
        if (!state.selectedMailMessage) throw new Error("Select a message first");
        const text = state.selectedMailMessage.text || state.selectedMailMessage.html || "";
        const payload = state.selectedMailMessage.ebpPayload || extractEbpPayloadFromText(text);
        if (!payload) throw new Error("No EBP payload markers found in this message");
        const sender = document.getElementById("mail-sender-contact").value.trim();
        const senderEmail = extractEmailAddress(state.selectedMailMessage.from || "");
        const password = await requestPassword("Enter password to decrypt EBP payload from email");
        if (!password) return;
        const res = await api("/decrypt", {
          method: "POST",
          body: JSON.stringify({
            payload,
            password,
            sender: sender || undefined,
            senderEmail: senderEmail || undefined,
          }),
        });
        state.selectedMailMessage = {
          ...(state.selectedMailMessage || {}),
          text: res.message || "",
          html: "",
        };
        renderSelectedMailMessageBody();
        updateVerifyResult("mail-verify-result", res.verified, res.verifyStatus);
        renderMailVerifyMeta(res);
        setStatus("EBP payload decrypted", "success");
      } catch (err) {
        updateVerifyResult("mail-verify-result", null, null);
        renderMailVerifyMeta(null);
        setStatus(err.message, "error");
      }
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
      const composeTo = document.getElementById("mail-compose-to");
      const composeSubject = document.getElementById("mail-compose-subject");
      const composeBody = document.getElementById("mail-compose-body");
      if (composeTo) composeTo.value = fromAddress;
      if (composeSubject) composeSubject.value = subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject || "(no subject)"}`;
      setMailTab("compose");
      composeBody?.focus();
      setStatus("Reply drafted from selected message", "success");
    });
  }

  const composeForm = document.getElementById("mail-compose-form");
  if (composeForm) {
    const modeEl = document.getElementById("mail-compose-mode");
    const recipientEl = document.getElementById("mail-compose-recipient");
    if (modeEl) modeEl.addEventListener("change", updateMailComposeSendState);
    if (recipientEl) recipientEl.addEventListener("input", updateMailComposeSendState);
    updateMailComposeSendState();

    composeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type="submit"]');
      await withLoading(btn, async () => {
        try {
          const to = document.getElementById("mail-compose-to").value.trim();
          const subject = document.getElementById("mail-compose-subject").value.trim();
          const mode = document.getElementById("mail-compose-mode").value;
          const body = document.getElementById("mail-compose-body").value;
          const recipient = document.getElementById("mail-compose-recipient").value.trim();
          if (!to || !subject) throw new Error("To and subject are required");

          let outboundBody = body;
          if (mode === "ebp-encrypt") {
            if (!recipient) throw new Error("EBP recipient contact is required for EBP mode");
            const password = await requestPassword("Enter password to sign/encrypt this email body");
            if (!password) return;
            const encrypted = await api("/encrypt", {
              method: "POST",
              body: JSON.stringify({
                message: body,
                recipient,
                sign: true,
                password,
                includePublicKeys: state.mailIncludePublicKeys,
              }),
            });
            outboundBody = [
              "-----BEGIN EBP MESSAGE-----",
              JSON.stringify(encrypted, null, 2),
              "-----END EBP MESSAGE-----",
            ].join("\n");
          }

          await api("/mail/send", {
            method: "POST",
            body: JSON.stringify({
              accountId: state.selectedMailAccountId || undefined,
              to,
              subject,
              text: outboundBody,
            }),
          });
          setStatus("Email sent", "success");
          document.getElementById("mail-compose-subject").value = "";
          document.getElementById("mail-compose-body").value = "";
        } catch (err) {
          setStatus(err.message, "error");
        }
      });
    });
  }
}
