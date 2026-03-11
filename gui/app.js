const statusEl = document.getElementById("status");
const DEFAULT_SERVER_URL = "https://ebp-cqyo.onrender.com";
const LOCAL_BACKEND_ORIGIN = "http://127.0.0.1:8787";
const MAIL_RENDER_HTML_PREF_KEY = "ebp.mail.renderHtml";
const STARTUP_RETRY_ATTEMPTS = 12;
const STARTUP_RETRY_DELAY_MS = 500;
const ctxCurrent = document.getElementById("ctx-current");
const ctxServer = document.getElementById("ctx-server");
const ctxIdir = document.getElementById("ctx-idir");
const ctxFingerprint = document.getElementById("ctx-fingerprint");
const ctxFingerprintContainer = document.getElementById("ctx-fingerprint-container");
const identityList = document.getElementById("identity-list");
const identityDetailsList = document.getElementById("identity-details-list");
const contactsList = document.getElementById("contacts-list");
const serverIdentitiesList = document.getElementById("server-identities-list");

let serverDefaultApplied = false;
const state = {
  currentIdentity: null,
  currentFingerprint: null,
  currentDetails: [], // Array of {path, detail}
  serverDetails: [], // Array of {path, detail} - details on the server for current identity
  serverDetailsMeta: {}, // {path: {verified, verifiedAt}}
  server: null,
  protocolVersion: null,
  identities: [],
  contacts: [],
  serverIdentities: [],
  hierarchyRelationships: [],
  serverIdentitiesPagination: { page: 1, totalPages: 1, total: 0 },
  serverIdentitiesSearch: "",
  identityDir: "",
  isRevoked: false,
  revokedDetails: [],
  mailAccount: null,
  mailAccounts: [],
  selectedMailAccountId: null,
  mailCreatingNewAccount: false,
  mailSecretsInMemory: false,
  mailSecretsLocked: false,
  settingsMailCredentials: [],
  mailMessages: [],
  mailPagination: { page: 1, totalPages: 1, total: 0 },
  selectedMailMessage: null,
  selectedMailMessageUid: null,
  mailMessageLoading: false,
  mailMessageLoadRequestId: 0,
  mailRenderHtml: false,
  mailOAuthPendingState: "",
  mailOAuthProvider: "",
  mailOAuthEmail: "",
  mailActiveTab: "inbox",
};
let decryptedFileResult = null;

function loadBooleanPreference(key, fallback = false) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function saveBooleanPreference(key, value) {
  try {
    localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

function loadUiPreferences() {
  state.mailRenderHtml = loadBooleanPreference(MAIL_RENDER_HTML_PREF_KEY, false);
}

// Helper to extract name/email from details
function getDetailValue(details, path) {
  if (!details) return null;
  // Handle array format [{path, detail}]
  if (Array.isArray(details)) {
    const found = details.find(d => d.path === path);
    return found?.detail || null;
  }
  // Handle object format {path: [detail, proof]} or {path: detail}
  const val = details[path];
  if (Array.isArray(val)) return val[0];
  return val || null;
}

function getDetailMeta(detailsMeta, path) {
  if (!detailsMeta || typeof detailsMeta !== "object") return null;
  return detailsMeta[path] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fingerprint Management
// ─────────────────────────────────────────────────────────────────────────────

function updateCurrentFingerprint(fingerprint) {
  state.currentFingerprint = fingerprint;
  renderFingerprint();
}

function renderFingerprint() {
  if (state.currentFingerprint) {
    ctxFingerprint.textContent = state.currentFingerprint;
    ctxFingerprint.title = state.currentFingerprint; // Full fingerprint on hover
    ctxFingerprintContainer.style.display = "flex";
  } else {
    ctxFingerprintContainer.style.display = "none";
  }
}

/** Fetch public identity info (including fingerprint and details) - no password required */
async function loadPublicIdentityInfo() {
  try {
    const res = await api("/identity/public");
    if (res.available && res.fingerprint) {
      updateCurrentFingerprint(res.fingerprint);
      // Details are in the public data if available
      state.currentDetails = res.details || [];
      state.isRevoked = res.isRevoked || false;
      state.revokedDetails = res.revokedDetails || [];
      
      // Also try to fetch server details to compare
      await loadServerDetailsForCurrentIdentity(res.fingerprint);
      
      renderIdentityDetails();
      updateRevokeDetailPathOptions();
      updateRevocationStatus(state.isRevoked);
    } else {
      // Legacy format - clear fingerprint and details
      state.currentFingerprint = null;
      state.currentDetails = [];
      state.serverDetails = [];
      state.serverDetailsMeta = {};
      state.isRevoked = false;
      state.revokedDetails = [];
      renderFingerprint();
      renderIdentityDetails();
      updateRevokeDetailPathOptions();
      updateRevocationStatus(false);
    }
  } catch (err) {
    // Identity might not exist yet
    state.currentFingerprint = null;
    state.currentDetails = [];
    state.serverDetails = [];
    state.serverDetailsMeta = {};
    state.isRevoked = false;
    state.revokedDetails = [];
    renderFingerprint();
    renderIdentityDetails();
    updateRevokeDetailPathOptions();
    updateRevocationStatus(false);
    console.warn("Could not load public identity info:", err);
  }
}

/** Fetch current identity's details from server for comparison */
async function loadServerDetailsForCurrentIdentity(fingerprint) {
  if (!state.server || !fingerprint) {
    state.serverDetails = [];
    state.serverDetailsMeta = {};
    return;
  }
  
  try {
    // Fetch directly from server to get current state
    const res = await fetch(`${state.server}/api/v1/identity/${fingerprint}`);
    if (res.ok) {
      const data = await res.json();
      if (data.details) {
        state.serverDetails = Object.entries(data.details).map(([path, val]) => ({
          path,
          detail: Array.isArray(val) ? val[0] : val
        }));
        state.serverDetailsMeta = data.detailsMeta || {};
      } else {
        state.serverDetails = [];
        state.serverDetailsMeta = {};
      }
    } else if (res.status === 404) {
      // Identity not on server yet
      state.serverDetails = [];
      state.serverDetailsMeta = {};
    } else {
      state.serverDetails = [];
      state.serverDetailsMeta = {};
    }
  } catch (err) {
    state.serverDetails = [];
    state.serverDetailsMeta = {};
    console.warn("Could not load server details:", err);
  }
}

function renderIdentityDetails() {
  if (!identityDetailsList) return;
  identityDetailsList.innerHTML = "";
  
  if (!state.currentDetails || state.currentDetails.length === 0) {
    identityDetailsList.innerHTML = "<li class='muted'>(no details attached)</li>";
    return;
  }
  
  // Handle both array format [{path, detail}] and object format {path: [detail, proof]}
  const details = Array.isArray(state.currentDetails) 
    ? state.currentDetails 
    : Object.entries(state.currentDetails).map(([path, val]) => ({
        path,
        detail: Array.isArray(val) ? val[0] : val
      }));
  
  for (const item of details) {
    const li = document.createElement("li");
    li.className = "detail-item";
    
    // Check if this detail exists on server
    const serverDetail = state.serverDetails.find(d => d.path === item.path);
    const isOnServer = serverDetail && serverDetail.detail === item.detail;
    const isLocalOnly = !isOnServer;
    const isEmailDetail = item.path === "email";
    const emailMeta = isEmailDetail && isOnServer
      ? (state.serverDetailsMeta?.email || null)
      : null;
    const emailMarker = emailMeta?.verified
      ? '<span class="email-verified" title="Email verified">●</span>'
      : "";
    const emailAction = emailMeta && !emailMeta.verified
      ? `<button class="btn-verify-email secondary" data-email="${escapeHtml(item.detail)}">Send verification link</button>`
      : "";
    
    li.innerHTML = `
      <div class="detail-item-content">
        <div class="detail-text">
          <strong>${escapeHtml(item.path)}</strong>:
          <span class="detail-value" title="${escapeHtml(item.detail)}">${escapeHtml(item.detail)}</span>
          ${emailMarker}
        </div>
        ${isLocalOnly && state.server ? '<span class="local-only-badge">Local only</span>' : ''}
        ${isOnServer ? '<span class="synced-badge">✓ Synced</span>' : ''}
      </div>
      ${emailAction}
      ${isLocalOnly && state.server ? `
        <button class="btn-push-detail secondary" data-path="${escapeHtml(item.path)}" data-detail="${escapeHtml(item.detail)}">
          Push to Server
        </button>
      ` : ''}
    `;
    identityDetailsList.appendChild(li);
  }
  
  // Add click handlers for push buttons
  identityDetailsList.querySelectorAll(".btn-push-detail").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const path = btn.dataset.path;
      await showPushDetailModal(path, btn);
    });
  });

  // Add click handlers for verification buttons
  identityDetailsList.querySelectorAll(".btn-verify-email").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = btn.dataset.email;
      await requestEmailVerification(email, btn);
    });
  });
}

async function showPushDetailModal(path, btn) {
  const password = await requestPassword(`Enter password to push "${path}" to server`);
  if (!password) return;
  
  if (btn) setButtonLoading(btn, true);
  try {
    const detail = state.currentDetails.find(d => d.path === path)?.detail;
    await api("/detail", {
      method: "POST",
      body: JSON.stringify({ path, detail, password, push: true }),
    });
    setStatus(`Detail "${path}" pushed to server`, "success");
    await loadAll();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

async function requestEmailVerification(email, btn) {
  if (!state.server) {
    setStatus("No server configured for verification", "error");
    return;
  }
  if (!email) {
    setStatus("Email detail missing", "error");
    return;
  }

  if (btn) setButtonLoading(btn, true);
  try {
    await api("/verify-email/request", {
      method: "POST",
      body: JSON.stringify({
        fingerprint: state.currentFingerprint,
        detail: email,
      }),
    });
    setStatus(`Verification email sent to ${email}`, "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

const navItems = document.querySelectorAll(".nav-item[data-page]");
const pages = document.querySelectorAll(".page");

function navigateTo(pageId) {
  // Update nav items
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageId);
  });

  // Update pages
  pages.forEach((page) => {
    page.classList.toggle("active", page.id === `page-${pageId}`);
  });

  // Store in URL hash for bookmarking
  window.location.hash = pageId;

  if (pageId === "mail") {
    void ensureMailPageUnlocked();
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    navigateTo(item.dataset.page);
  });
});

// Handle initial hash or default to identities
function initNavigation() {
  const hash = window.location.hash.slice(1);
  const validPages = Array.from(navItems).map((item) => item.dataset.page);
  if (hash && validPages.includes(hash)) {
    navigateTo(hash);
  } else {
    navigateTo("identities");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible section cards
// ─────────────────────────────────────────────────────────────────────────────

function setSectionCollapsed(section, collapsed) {
  const toggle = section.querySelector(":scope > .section-toggle");
  const content = section.querySelector(":scope > .section-content");
  if (!toggle || !content) return;
  section.classList.toggle("is-collapsed", collapsed);
  toggle.setAttribute("aria-expanded", String(!collapsed));
  content.style.display = collapsed ? "none" : "";
}

function makeSectionCollapsible(section) {
  if (section.classList.contains("collapsible-section")) return;
  const heading = section.querySelector(":scope > h3");
  if (!heading) return;

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "section-toggle";

  const chevron = document.createElement("span");
  chevron.className = "section-chevron";
  chevron.textContent = "▾";
  chevron.setAttribute("aria-hidden", "true");

  toggle.appendChild(heading);
  toggle.appendChild(chevron);

  const content = document.createElement("div");
  content.className = "section-content";

  while (section.firstChild) {
    if (section.firstChild !== toggle) {
      content.appendChild(section.firstChild);
    } else {
      break;
    }
  }

  section.innerHTML = "";
  section.classList.add("collapsible-section");
  section.appendChild(toggle);
  section.appendChild(content);

  const expandedByDefault = section.dataset.expandedByDefault === "true";
  setSectionCollapsed(section, !expandedByDefault);

  toggle.addEventListener("click", () => {
    const isCollapsed = section.classList.contains("is-collapsed");
    setSectionCollapsed(section, !isCollapsed);
  });
}

function initCollapsibleSections() {
  document.querySelectorAll(".page section").forEach((section) => {
    makeSectionCollapsible(section);
  });
}

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.slice(1);
  const validPages = Array.from(navItems).map((item) => item.dataset.page);
  if (hash && validPages.includes(hash)) {
    navigateTo(hash);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Modal
// ─────────────────────────────────────────────────────────────────────────────

const confirmModal = document.getElementById("confirm-modal");
const confirmModalTitle = document.getElementById("confirm-modal-title");
const confirmModalMessage = document.getElementById("confirm-modal-message");
const confirmModalCancel = document.getElementById("confirm-modal-cancel");
const confirmModalConfirm = document.getElementById("confirm-modal-confirm");

const passwordModal = document.getElementById("password-modal");
const passwordModalTitle = document.getElementById("password-modal-title");
const passwordModalInput = document.getElementById("password-modal-input");
const passwordModalError = document.getElementById("password-modal-error");
const passwordModalCancel = document.getElementById("password-modal-cancel");
const passwordModalConfirm = document.getElementById("password-modal-confirm");
const passwordModalToggle = document.getElementById("password-modal-toggle");

let modalResolve = null;
let passwordModalResolve = null;

function showConfirmModal(title, message, confirmText = "Confirm") {
  confirmModalTitle.textContent = title;
  confirmModalMessage.textContent = message;
  confirmModalConfirm.textContent = confirmText;
  confirmModal.classList.add("active");

  return new Promise((resolve) => {
    modalResolve = resolve;
  });
}

function closeModal(result) {
  confirmModal.classList.remove("active");
  if (modalResolve) {
    modalResolve(result);
    modalResolve = null;
  }
}

confirmModalCancel.addEventListener("click", () => closeModal(false));
confirmModalConfirm.addEventListener("click", () => closeModal(true));
confirmModal.addEventListener("click", (e) => {
  if (e.target === confirmModal) closeModal(false);
});

async function requestPassword(promptText = "Enter password") {
  passwordModalTitle.textContent = promptText;
  passwordModalInput.value = "";
  passwordModalInput.type = "password";
  passwordModalToggle.textContent = "👁";
  passwordModalError.textContent = "";
  passwordModal.classList.add("active");
  passwordModalInput.focus();

  return new Promise((resolve) => {
    passwordModalResolve = resolve;
  });
}

function closePasswordModal(result) {
  passwordModal.classList.remove("active");
  if (passwordModalResolve) {
    passwordModalResolve(result);
    passwordModalResolve = null;
  }
}

passwordModalCancel.addEventListener("click", () => closePasswordModal(null));
passwordModalConfirm.addEventListener("click", () => {
  const value = passwordModalInput.value;
  if (!value) {
    passwordModalError.textContent = "Password is required.";
    return;
  }
  closePasswordModal(value);
});

passwordModal.addEventListener("click", (e) => {
  if (e.target === passwordModal) closePasswordModal(null);
});

passwordModalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    passwordModalConfirm.click();
  } else if (e.key === "Escape") {
    closePasswordModal(null);
  }
});

passwordModalToggle.addEventListener("click", (e) => {
  e.preventDefault();
  const isPassword = passwordModalInput.type === "password";
  passwordModalInput.type = isPassword ? "text" : "password";
  passwordModalToggle.textContent = isPassword ? "🙈" : "👁";
  passwordModalInput.focus();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (confirmModal.classList.contains("active")) {
      closeModal(false);
    }
    if (passwordModal.classList.contains("active")) {
      closePasswordModal(null);
    }
    const contactModal = document.getElementById("contact-detail-modal");
    if (contactModal.classList.contains("active")) {
      contactModal.classList.remove("active");
    }
  }
});

// Contact detail modal handlers
document.getElementById("contact-detail-close").addEventListener("click", () => {
  document.getElementById("contact-detail-modal").classList.remove("active");
});

document.getElementById("contact-detail-modal").addEventListener("click", (e) => {
  if (e.target.id === "contact-detail-modal") {
    document.getElementById("contact-detail-modal").classList.remove("active");
  }
});

document.getElementById("contact-detail-sync-btn").addEventListener("click", async (e) => {
  const btn = e.target;
  const fingerprint = btn.dataset.fingerprint;
  const name = btn.dataset.name;
  await syncContact(fingerprint, name, btn);
});

document.getElementById("contact-detail-delete-btn").addEventListener("click", async (e) => {
  const btn = e.target;
  const name = btn.dataset.name;
  const fingerprint = btn.dataset.fingerprint;
  await deleteLocalContact(name, fingerprint, btn);
});

document.getElementById("contact-detail-establish-hierarchy-btn").addEventListener("click", (e) => {
  const btn = e.target;
  const fingerprint = btn.dataset.fingerprint;
  if (!fingerprint) {
    setStatus("Contact fingerprint missing", "error");
    return;
  }
  navigateToHierarchyWithContact(fingerprint);
  document.getElementById("contact-detail-modal").classList.remove("active");
});

document.getElementById("contact-detail-hierarchy-btn").addEventListener("click", async (e) => {
  const btn = e.target;
  const fingerprint = btn.dataset.fingerprint;
  if (!fingerprint) {
    setStatus("Contact fingerprint missing", "error");
    return;
  }
  setButtonLoading(btn, true);
  try {
    await loadContactHierarchyDiagram(fingerprint);
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    setButtonLoading(btn, false);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UI Helpers
// ─────────────────────────────────────────────────────────────────────────────

function setStatus(msg, kind = "info") {
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
  // Re-trigger animation
  statusEl.style.animation = "none";
  statusEl.offsetHeight; // force reflow
  statusEl.style.animation = "";
}

function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

async function withLoading(btn, fn) {
  setButtonLoading(btn, true);
  try {
    await fn();
  } finally {
    setButtonLoading(btn, false);
  }
}

async function hashTextSha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return bytesToHex(new Uint8Array(digest));
}

async function getPayloadDownloadName(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  switch (payload.type) {
    case "ebp-signature":
      return "ebp-signature.json";
    case "ebp-signed-message":
      if (typeof payload.messageHash === "string" && payload.messageHash.length >= 8) {
        return `ebp-signed-message-${payload.messageHash.slice(0, 8)}.json`;
      }
      if (typeof payload.message === "string" && payload.message.length > 0) {
        const messageHash = await hashTextSha256Hex(payload.message);
        return `ebp-signed-message-${messageHash.slice(0, 8)}.json`;
      }
      return "ebp-signed-message.json";
    case "ebp-signed-file":
      if (typeof payload.fileHash === "string" && payload.fileHash.length >= 8) {
        const prefix = payload.fileHash.slice(0, 8);
        return `ebp-signed-file-${prefix}.json`;
      }
      return "ebp-signed-file.json";
    case "ebp-encrypted-message":
      return "ebp-encrypted-message.json";
    case "ebp-encrypted-signed-message":
      return "ebp-encrypted-signed-message.json";
    case "ebp-encrypted-file":
      return `ebp-encrypted-file-${safeDownloadFileName(payload.fileName || "file")}.json`;
    case "ebp-encrypted-signed-file":
      return `ebp-encrypted-signed-file-${safeDownloadFileName(payload.fileName || "file")}.json`;
    default:
      return fallback;
  }
}

async function downloadJsonFromTextarea(textareaId, fallbackName) {
  const textarea = document.getElementById(textareaId);
  if (!textarea || !textarea.value) return;

  try {
    const payload = JSON.parse(textarea.value);
    const filename = await getPayloadDownloadName(payload, fallbackName);
    const pretty = JSON.stringify(payload, null, 2) + "\n";
    const blob = new Blob([pretty], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus("Output is not valid JSON", "error");
  }
}

async function loadJsonFileIntoTextarea(fileInput, textareaId) {
  const textarea = document.getElementById(textareaId);
  const file = fileInput?.files?.[0];
  if (!textarea || !file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    textarea.value = JSON.stringify(payload, null, 2);
    setStatus(`Loaded ${file.name}`, "success");
  } catch (err) {
    setStatus("Invalid JSON file", "error");
  } finally {
    fileInput.value = "";
  }
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hashFileSha256Hex(file) {
  const arrayBuffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
  return bytesToHex(new Uint8Array(digest));
}

function generateRandomSaltHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function buildFileSignMessage(fileHash, salt, contextMessage) {
  return `ebp::filehash::${fileHash}::${salt || ""}::${contextMessage || ""}`;
}

async function readFileAsBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function safeDownloadFileName(fileName) {
  if (!fileName || typeof fileName !== "string") return "decrypted.bin";
  return fileName
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/\.\./g, "_") || "decrypted.bin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy to clipboard
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    const targetId = btn.dataset.target;
    const textarea = document.getElementById(targetId);
    if (!textarea || !textarea.value) return;

    try {
      await navigator.clipboard.writeText(textarea.value);
      btn.textContent = "Copied!";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  });
});

// Copy fingerprint button
document.getElementById("copy-fingerprint-btn").addEventListener("click", async (e) => {
  e.preventDefault();
  if (!state.currentFingerprint) return;

  try {
    await navigator.clipboard.writeText(state.currentFingerprint);
    const btn = e.target;
    btn.textContent = "✓";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = "📋";
      btn.classList.remove("copied");
    }, 2000);
  } catch (err) {
    console.error("Copy failed:", err);
  }
});

const signDownloadBtn = document.getElementById("sign-download-btn");
if (signDownloadBtn) {
  signDownloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await downloadJsonFromTextarea("sign-output", "ebp-signed-message.json");
  });
}

const encDownloadBtn = document.getElementById("enc-download-btn");
if (encDownloadBtn) {
  encDownloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await downloadJsonFromTextarea("enc-output", "ebp-encrypted-message.json");
  });
}

const encFileDownloadBtn = document.getElementById("enc-file-download-btn");
if (encFileDownloadBtn) {
  encFileDownloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await downloadJsonFromTextarea("enc-file-output", "ebp-encrypted-file.json");
  });
}

const signFileDownloadBtn = document.getElementById("sign-file-download-btn");
if (signFileDownloadBtn) {
  signFileDownloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    await downloadJsonFromTextarea("sign-file-output", "ebp-signed-file.json");
  });
}

const verifyPayloadFile = document.getElementById("verify-payload-file");
if (verifyPayloadFile) {
  verifyPayloadFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(verifyPayloadFile, "verify-payload");
    updateVerifyResult("verify-result", null, null);
  });
}

const verifyPublicKeysFile = document.getElementById("verify-public-keys-file");
if (verifyPublicKeysFile) {
  verifyPublicKeysFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(verifyPublicKeysFile, "verify-public-keys");
    updateVerifyResult("verify-result", null, null);
  });
}

const decryptPayloadFile = document.getElementById("dec-payload-file");
if (decryptPayloadFile) {
  decryptPayloadFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(decryptPayloadFile, "dec-payload");
    updateVerifyResult("dec-verified", null, null);
  });
}

const decryptFilePayloadFile = document.getElementById("dec-file-payload-file");
if (decryptFilePayloadFile) {
  decryptFilePayloadFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(decryptFilePayloadFile, "dec-file-payload");
    updateVerifyResult("dec-file-verified", null, null);
    const info = document.getElementById("dec-file-info");
    const downloadBtn = document.getElementById("dec-file-download-btn");
    if (info) info.value = "";
    if (downloadBtn) downloadBtn.disabled = true;
    decryptedFileResult = null;
  });
}

const verifyFilePayloadFile = document.getElementById("verify-file-payload-file");
if (verifyFilePayloadFile) {
  verifyFilePayloadFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(verifyFilePayloadFile, "verify-file-payload");
    updateVerifyResult("verify-file-result", null, null);
    const details = document.getElementById("verify-file-details");
    const signedMessage = document.getElementById("verify-file-signed-message");
    if (details) details.value = "";
    if (signedMessage) signedMessage.value = "";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

async function api(path, init = {}) {
  const res = await fetch(`${LOCAL_BACKEND_ORIGIN}/api/v1${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = body && body.error ? body.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact Search Autocomplete
// ─────────────────────────────────────────────────────────────────────────────

const contactSearchFields = [
  { inputId: "enc-recipient", dropdownId: "enc-recipient-dropdown" },
  { inputId: "verify-sender", dropdownId: "verify-sender-dropdown" },
  { inputId: "dec-sender", dropdownId: "dec-sender-dropdown" },
  { inputId: "enc-file-recipient", dropdownId: "enc-file-recipient-dropdown" },
  { inputId: "dec-file-sender", dropdownId: "dec-file-sender-dropdown" },
  { inputId: "mail-compose-recipient", dropdownId: "mail-compose-recipient-dropdown" },
  { inputId: "hierarchy-other-fingerprint", dropdownId: "hierarchy-other-fingerprint-dropdown" },
];

let activeDropdown = null;
let highlightedIndex = -1;

function initContactSearch() {
  for (const field of contactSearchFields) {
    const input = document.getElementById(field.inputId);
    const dropdown = document.getElementById(field.dropdownId);
    if (!input || !dropdown) continue;

    // Input event - filter contacts
    input.addEventListener("input", () => {
      filterContacts(input, dropdown);
    });

    // Focus event - show dropdown if has value
    input.addEventListener("focus", () => {
      filterContacts(input, dropdown);
    });

    // Keyboard navigation
    input.addEventListener("keydown", (e) => {
      handleSearchKeydown(e, input, dropdown);
    });

    // Click outside to close
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".contact-search-wrapper")) {
        closeAllDropdowns();
      }
    });
  }

  // Clear buttons
  document.querySelectorAll(".contact-search-clear").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.dataset.target;
      const input = document.getElementById(targetId);
      if (input) {
        input.value = "";
        input.focus();
        closeAllDropdowns();
      }
    });
  });
}

function filterContacts(input, dropdown) {
  const query = input.value.trim().toLowerCase();
  
  // Close if no contacts
  if (!state.contacts.length) {
    dropdown.innerHTML = '<div class="contact-search-no-results">No contacts available</div>';
    dropdown.classList.add("active");
    activeDropdown = dropdown;
    highlightedIndex = -1;
    return;
  }

  // Filter contacts by name, email, or fingerprint
  const filtered = state.contacts.filter((c) => {
    const name = (c.name || "").toLowerCase();
    const fingerprint = (c.fingerprint || "").toLowerCase();
    const email = (getDetailValue(c.details, "email") || "").toLowerCase();
    const detailName = (getDetailValue(c.details, "name") || "").toLowerCase();
    
    if (!query) return true; // Show all if no query
    
    return (
      name.includes(query) ||
      fingerprint.includes(query) ||
      email.includes(query) ||
      detailName.includes(query)
    );
  });

  renderContactDropdown(filtered, dropdown, query, input);
}

function renderContactDropdown(contacts, dropdown, query, input) {
  dropdown.innerHTML = "";
  highlightedIndex = -1;

  if (!contacts.length) {
    dropdown.innerHTML = `
      <div class="contact-search-no-results">No matching contacts</div>
      <div class="contact-search-hint">You can also enter a fingerprint directly</div>
    `;
    dropdown.classList.add("active");
    activeDropdown = dropdown;
    return;
  }

  // Limit to first 10 results for performance
  const displayContacts = contacts.slice(0, 10);

  for (let i = 0; i < displayContacts.length; i++) {
    const c = displayContacts[i];
    const item = document.createElement("div");
    item.className = "contact-search-item";
    item.dataset.index = i;
    item.dataset.name = c.name;
    item.dataset.fingerprint = c.fingerprint;

    const email = getDetailValue(c.details, "email");
    const detailName = getDetailValue(c.details, "name");
    const shortFp = c.fingerprint.substring(0, 24) + "...";

    item.innerHTML = `
      <div class="contact-search-item-name">
        ${highlightMatch(escapeHtml(c.name), query)}
      </div>
      ${detailName || email ? `
        <div class="contact-search-item-details">
          ${detailName ? `<span class="contact-search-item-detail">👤 ${highlightMatch(escapeHtml(detailName), query)}</span>` : ""}
          ${email ? `<span class="contact-search-item-detail">✉️ ${highlightMatch(escapeHtml(email), query)}</span>` : ""}
        </div>
      ` : ""}
      <div class="contact-search-item-fingerprint">${highlightMatch(escapeHtml(shortFp), query)}</div>
    `;

    item.addEventListener("click", () => {
      selectContact(input, c);
      dropdown.classList.remove("active");
    });

    item.addEventListener("mouseenter", () => {
      highlightedIndex = i;
      updateHighlight(dropdown);
    });

    dropdown.appendChild(item);
  }

  if (contacts.length > 10) {
    const hint = document.createElement("div");
    hint.className = "contact-search-hint";
    hint.textContent = `Showing 10 of ${contacts.length} matches. Type more to narrow down.`;
    dropdown.appendChild(hint);
  }

  dropdown.classList.add("active");
  activeDropdown = dropdown;
}

function highlightMatch(text, query) {
  if (!query) return text;
  const regex = new RegExp(`(${escapeRegex(query)})`, "gi");
  return text.replace(regex, '<span class="match-highlight">$1</span>');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectContact(input, contact) {
  // Hierarchy create requires explicit fingerprint; other flows can use name.
  if (input.id === "hierarchy-other-fingerprint") {
    input.value = contact.fingerprint;
  } else {
    input.value = contact.name;
  }
  closeAllDropdowns();
  updateMailComposeSendState();
}

function handleSearchKeydown(e, input, dropdown) {
  const items = dropdown.querySelectorAll(".contact-search-item");
  
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!dropdown.classList.contains("active")) {
      filterContacts(input, dropdown);
    }
    highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
    updateHighlight(dropdown);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    highlightedIndex = Math.max(highlightedIndex - 1, 0);
    updateHighlight(dropdown);
  } else if (e.key === "Enter" && dropdown.classList.contains("active")) {
    if (highlightedIndex >= 0 && items[highlightedIndex]) {
      e.preventDefault();
      items[highlightedIndex].click();
    }
  } else if (e.key === "Escape") {
    closeAllDropdowns();
  }
}

function updateHighlight(dropdown) {
  const items = dropdown.querySelectorAll(".contact-search-item");
  items.forEach((item, i) => {
    item.classList.toggle("highlighted", i === highlightedIndex);
    if (i === highlightedIndex) {
      item.scrollIntoView({ block: "nearest" });
    }
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".contact-search-dropdown").forEach((d) => {
    d.classList.remove("active");
  });
  activeDropdown = null;
  highlightedIndex = -1;
}

function updateMailComposeSendState() {
  const modeEl = document.getElementById("mail-compose-mode");
  const recipientEl = document.getElementById("mail-compose-recipient");
  const sendBtn = document.getElementById("mail-compose-send-btn");
  if (!modeEl || !recipientEl || !sendBtn) return;
  const requiresRecipient = modeEl.value === "ebp-encrypt";
  const hasRecipient = recipientEl.value.trim().length > 0;
  sendBtn.disabled = requiresRecipient && !hasRecipient;
}

function setMailTab(tabName) {
  const safeTab = tabName || "inbox";
  state.mailActiveTab = safeTab;
  document.querySelectorAll("[data-mail-tab]").forEach((btn) => {
    const active = btn.dataset.mailTab === safeTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-expanded", String(active));
  });
  document.querySelectorAll("[data-mail-tab-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.mailTabPanel === safeTab);
  });
}

function initMailTabs() {
  document.querySelectorAll("[data-mail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMailTab(btn.dataset.mailTab || "inbox");
    });
  });
  setMailTab(state.mailActiveTab || "inbox");
}

function syncMailFolderCustomUi() {
  const folderEl = document.getElementById("mail-folder");
  const customWrap = document.getElementById("mail-folder-custom-wrap");
  if (!folderEl || !customWrap) return;
  customWrap.classList.toggle("visible", folderEl.value === "__custom__");
}

function getSelectedMailFolder() {
  const folderEl = document.getElementById("mail-folder");
  const customEl = document.getElementById("mail-folder-custom");
  const folderValue = folderEl ? String(folderEl.value || "").trim() : "";
  if (folderValue === "__custom__") {
    return (customEl?.value || "").trim() || "INBOX";
  }
  return folderValue || "INBOX";
}

// ─────────────────────────────────────────────────────────────────────────────
// Server identity search (name, email, fingerprint)
// ─────────────────────────────────────────────────────────────────────────────

const serverIdentitySearchInput = document.getElementById("server-identities-search");
let serverIdentitySearchTimeout = null;

if (serverIdentitySearchInput) {
  serverIdentitySearchInput.addEventListener("input", () => {
    state.serverIdentitiesSearch = serverIdentitySearchInput.value.trim();
    if (serverIdentitySearchTimeout) {
      clearTimeout(serverIdentitySearchTimeout);
    }
    serverIdentitySearchTimeout = setTimeout(async () => {
      const serverOverride = document.getElementById("server-identities-override")?.value.trim() || "";
      setStatus("Loading...");
      await loadServerIdentities(1, serverOverride || null, state.serverIdentitiesSearch);
      renderServerIdentities();
      setStatus("Ready", "success");
    }, 250);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Renderers
// ─────────────────────────────────────────────────────────────────────────────

function renderContext() {
  ctxCurrent.textContent = state.currentIdentity ?? "-";
  ctxServer.textContent = state.server ?? "(not set)";
  if (ctxIdir) {
    ctxIdir.textContent = state.identityDir ?? "-";
  }
  const ctxProtocol = document.getElementById("ctx-protocol");
  if (ctxProtocol) {
    ctxProtocol.textContent = state.protocolVersion ?? "-";
  }
  renderFingerprint();
}

function renderIdentities() {
  identityList.innerHTML = "";
  if (!state.identities.length) {
    identityList.innerHTML = "<li class='muted'>(no identities yet)</li>";
    return;
  }
  for (const identity of state.identities) {
    const name = identity.name;
    const publishedToServer = identity.publishedToServer;
    
    const li = document.createElement("li");
    const isCurrent = name === state.currentIdentity;
    if (isCurrent) li.classList.add("current");
    if (!isCurrent) li.classList.add("clickable");

    const serverStatus = state.server 
      ? (publishedToServer 
          ? '<span class="published-badge">☁️ Published</span>' 
          : '<span class="local-only-badge">Local only</span>')
      : '';

    li.innerHTML = `
      <div class="identity-item">
        <span class="identity-item-name">${escapeHtml(name)}${isCurrent ? '<span class="badge">current</span>' : ""}${serverStatus}</span>
        <span class="identity-item-action">${isCurrent ? "" : "Click to switch →"}</span>
      </div>
    `;

    if (!isCurrent) {
      li.addEventListener("click", () => handleIdentityClick(name));
    }

    identityList.appendChild(li);
  }
}

async function handleIdentityClick(name) {
  const confirmed = await showConfirmModal(
    "Switch Identity",
    `Switch to identity "${name}"? This will change your active identity for all operations.`,
    "Switch"
  );

  if (confirmed) {
    try {
      setStatus("Switching identity...");
      await api("/identity/use", { method: "POST", body: JSON.stringify({ name }) });
      setStatus(`Switched to ${name}`, "success");
      // Clear details immediately while loading
      state.currentDetails = [];
      renderIdentityDetails();
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }
}

function renderContacts() {
  contactsList.innerHTML = "";
  if (!state.contacts.length) {
    contactsList.innerHTML = "<li class='muted'>(no contacts yet)</li>";
    return;
  }
  for (const c of state.contacts) {
    const li = document.createElement("li");
    li.className = "contact-item clickable";
    
    // Extract name and email from details if available
    const detailName = getDetailValue(c.details, "name");
    const detailEmail = getDetailValue(c.details, "email");
    const emailMeta = getDetailMeta(c.detailsMeta, "email");
    const emailVerified = emailMeta?.verified === true;
    const emailTagClass = emailVerified ? "email-verified-tag" : "email-unverified-tag";
    const emailTagTitle = emailVerified ? "Email verified" : "Email not verified";
    const isRevoked = !!c.revoked;
    
    li.innerHTML = `
      <div class="contact-info">
        <div class="contact-header">
          <strong>${escapeHtml(c.name)}</strong>
          ${isRevoked ? '<span class="revoked-badge">Revoked</span>' : ''}
          <span class="muted">(${escapeHtml(c.signingKeyType)}/${escapeHtml(c.encryptionKeyType)})</span>
        </div>
        ${detailName || detailEmail ? `
          <div class="contact-details-preview">
            ${detailName ? `<span class="detail-tag">👤 ${escapeHtml(detailName)}</span>` : ''}
            ${detailEmail ? `<span class="detail-tag ${emailTagClass}" title="${emailTagTitle}">✉️ ${escapeHtml(detailEmail)}</span>` : ''}
          </div>
        ` : ''}
        <div class="fingerprint">${escapeHtml(c.fingerprint)}</div>
      </div>
      <div class="contact-actions">
        <span class="click-hint">View details →</span>
      </div>
    `;
    
    li.addEventListener("click", () => showContactDetails(c));
    contactsList.appendChild(li);
  }
}

async function showContactDetails(contact) {
  // Build details HTML
  let detailsHtml = '<div class="contact-detail-list">';
  const emailMeta = getDetailMeta(contact.detailsMeta, "email");
  const emailVerified = emailMeta?.verified === true;
  const emailDot = emailVerified
    ? '<span class="email-status-dot email-verified" title="Email verified">●</span>'
    : '<span class="email-status-dot email-unverified" title="Email not verified">●</span>';
  
  if (contact.details && Object.keys(contact.details).length > 0) {
    const details = typeof contact.details === 'object' && !Array.isArray(contact.details)
      ? Object.entries(contact.details).map(([path, val]) => ({ path, detail: Array.isArray(val) ? val[0] : val }))
      : contact.details;
    
    for (const d of details) {
      const isEmail = d.path === "email";
      const valueHtml = isEmail
        ? `<span class="detail-value email-detail-value" title="${escapeHtml(d.detail)}">${escapeHtml(d.detail)}${emailDot}</span>`
        : `<span class="detail-value" title="${escapeHtml(d.detail)}">${escapeHtml(d.detail)}</span>`;
      detailsHtml += `
        <div class="detail-row">
          <strong>${escapeHtml(d.path)}:</strong>
          ${valueHtml}
        </div>
      `;
    }
  } else {
    detailsHtml += '<div class="muted">(no details available)</div>';
  }
  detailsHtml += '</div>';
  
  // Show modal with contact details
  const modal = document.getElementById("contact-detail-modal");
  document.getElementById("contact-detail-name").textContent = contact.name;
  document.getElementById("contact-detail-fingerprint").textContent = contact.fingerprint;
  document.getElementById("contact-detail-keytypes").textContent = `${contact.signingKeyType} / ${contact.encryptionKeyType}`;
  const revokedBanner = document.getElementById("contact-detail-revoked");
  if (revokedBanner) {
    if (contact.revoked) {
      revokedBanner.style.display = "flex";
    } else {
      revokedBanner.style.display = "none";
    }
  }
  document.getElementById("contact-detail-details").innerHTML = detailsHtml;
  document.getElementById("contact-detail-sync-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-sync-btn").dataset.name = contact.name;
  document.getElementById("contact-detail-delete-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-delete-btn").dataset.name = contact.name;
  document.getElementById("contact-detail-establish-hierarchy-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-hierarchy-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-hierarchy").innerHTML = '<div class="muted">(hierarchy not loaded)</div>';
  
  // Show server API link if server is configured
  const serverLinkContainer = document.getElementById("contact-detail-server-link-container");
  const serverLink = document.getElementById("contact-detail-server-link");
  if (state.server && contact.fingerprint) {
    const apiUrl = `${state.server}/api/v1/identity/${contact.fingerprint}`;
    serverLink.href = apiUrl;
    serverLink.textContent = apiUrl;
    serverLinkContainer.style.display = "block";
  } else {
    serverLinkContainer.style.display = "none";
  }
  
  modal.classList.add("active");
}

async function loadContactHierarchyDiagram(fingerprint) {
  const hierarchy = await api(`/hierarchy/${encodeURIComponent(fingerprint)}`);
  const container = document.getElementById("contact-detail-hierarchy");
  const focus = hierarchy.fingerprint || fingerprint;
  const relationships = Array.isArray(hierarchy.relationships) ? hierarchy.relationships : [];

  if (!relationships.length) {
    container.innerHTML = '<div class="muted">(no known hierarchy relationships)</div>';
    return;
  }

  const nodes = new Set([focus]);
  for (const edge of relationships) {
    if (edge && edge.masterFingerprint) nodes.add(edge.masterFingerprint);
    if (edge && edge.childFingerprint) nodes.add(edge.childFingerprint);
  }

  const ordered = Array.from(nodes.values());
  let html = "";
  for (const node of ordered) {
    const outgoing = relationships.filter((r) => r.masterFingerprint === node);
    const incoming = relationships.filter((r) => r.childFingerprint === node);
    const edgeLines = [];
    for (const edge of outgoing) {
      const exp = edge.expiry && edge.expiry !== 0 ? new Date(edge.expiry).toLocaleString() : "never";
      edgeLines.push(
        `<div class="hierarchy-edge ${edge.expired ? "expired" : ""}">` +
        `→ ${escapeHtml(edge.childFingerprint)} ` +
        `[${escapeHtml(edge.context || "no context")}; expiry: ${escapeHtml(String(exp))}${edge.expired ? "; EXPIRED" : ""}]` +
        `</div>`
      );
    }
    for (const edge of incoming) {
      edgeLines.push(
        `<div class="hierarchy-edge">← from ${escapeHtml(edge.masterFingerprint)}</div>`
      );
    }
    html += `
      <div class="hierarchy-node ${node === focus ? "focus" : ""}">
        <div><code>${escapeHtml(node)}</code></div>
        ${edgeLines.join("")}
      </div>
    `;
  }

  container.innerHTML = html;
}

function resolveHierarchyFingerprint(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("ebp")) return raw;
  const byName = state.contacts.find((c) => (c.name || "").toLowerCase() === raw.toLowerCase());
  if (byName?.fingerprint) return byName.fingerprint;
  const prefixMatches = state.contacts.filter((c) => (c.fingerprint || "").startsWith(raw));
  if (prefixMatches.length === 1) return prefixMatches[0].fingerprint;
  return raw;
}

function hierarchyRelationshipLabel(rel, currentFingerprint) {
  if (rel.masterFingerprint === currentFingerprint) {
    return `You are master of ${rel.childFingerprint}`;
  }
  if (rel.childFingerprint === currentFingerprint) {
    return `You are child of ${rel.masterFingerprint}`;
  }
  return `${rel.masterFingerprint} -> ${rel.childFingerprint}`;
}

async function renderHierarchyList() {
  const list = document.getElementById("hierarchy-relationships-list");
  if (!list) return;
  try {
    const res = await api("/hierarchy/list");
    const relationships = Array.isArray(res?.relationships) ? res.relationships : [];
    state.hierarchyRelationships = relationships;
    if (!relationships.length) {
      list.innerHTML = "<li class='muted'>(no hierarchy certificates yet)</li>";
      return;
    }
    list.innerHTML = "";
    for (const rel of relationships) {
      const li = document.createElement("li");
      const expires = rel.expiry && rel.expiry !== 0 ? new Date(rel.expiry).toLocaleString() : "never";
      li.innerHTML = `
        <div><strong>${escapeHtml(hierarchyRelationshipLabel(rel, state.currentFingerprint || ""))}</strong></div>
        <div class="muted">context: ${escapeHtml(rel.context || "none")} · expiry: ${escapeHtml(String(expires))}${rel.expired ? " · EXPIRED" : ""}</div>
      `;
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li class="muted">failed to load hierarchy: ${escapeHtml(err.message || String(err))}</li>`;
  }
}

function navigateToHierarchyWithContact(fingerprint) {
  navigateTo("identities");
  const sectionToggle = Array.from(document.querySelectorAll(".page.active section > .section-toggle")).find((toggle) =>
    toggle.textContent.includes("Hierarchy")
  );
  if (sectionToggle && sectionToggle.getAttribute("aria-expanded") !== "true") {
    sectionToggle.click();
  }
  const input = document.getElementById("hierarchy-other-fingerprint");
  if (input) {
    input.value = fingerprint;
    input.focus();
  }
}

async function handlePublishHierarchy(certificate) {
  if (!certificate) {
    setStatus("No hierarchy certificate to publish", "error");
    return;
  }
  await api("/hierarchy/publish", {
    method: "POST",
    body: JSON.stringify({ certificate }),
  });
}

async function deleteLocalContact(name, fingerprint, btn) {
  if (!name && !fingerprint) {
    setStatus("Contact identifier missing", "error");
    return;
  }

  const confirmed = await showConfirmModal(
    "Delete Local Contact",
    `Delete "${name || fingerprint}" from local contacts? This only removes the local copy.`,
    "Delete"
  );
  if (!confirmed) return;

  if (btn) setButtonLoading(btn, true);
  try {
    await api("/contacts/delete", {
      method: "POST",
      body: JSON.stringify({ name: name || undefined, fingerprint: fingerprint || undefined }),
    });
    document.getElementById("contact-detail-modal").classList.remove("active");
    setStatus(`Deleted local contact "${name || fingerprint}"`, "success");
    await loadAll();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

async function syncContact(fingerprint, name, btn) {
  if (btn) setButtonLoading(btn, true);
  try {
    await api("/fetch", {
      method: "POST",
      body: JSON.stringify({ fingerprint, name }),
    });
    setStatus(`Synced contact "${name}" from server`, "success");
    await loadAll();
    // Close modal and reopen with updated data
    document.getElementById("contact-detail-modal").classList.remove("active");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

function renderServerIdentities() {
  serverIdentitiesList.innerHTML = "";
  // Filter out revoked identities from browse list
  const visible = state.serverIdentities.filter((entry) => !entry.revoked);

  if (!visible.length) {
    serverIdentitiesList.innerHTML = "<li class='muted'>(none found)</li>";
  } else {
    for (const entry of visible) {
      const li = document.createElement("li");
      li.className = "server-identity-item";
      const created = entry.createdAt
        ? new Date(entry.createdAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "unknown";
      
      // Check if already in contacts
      const isAlreadyContact = state.contacts.some(c => c.fingerprint === entry.fingerprint);
      
      // Remove revoked details from preview if any remain
      const detailName = getDetailValue(entry.details, "name");
      const detailEmail = getDetailValue(entry.details, "email");
      
      li.innerHTML = `
        <div class="server-identity-info">
          ${detailName || detailEmail ? `
            <div class="server-identity-details-preview">
              ${detailName ? `<span class="detail-tag">👤 ${escapeHtml(detailName)}</span>` : ''}
              ${detailEmail ? `<span class="detail-tag">✉️ ${escapeHtml(detailEmail)}</span>` : ''}
            </div>
          ` : ''}
          <div class="fingerprint">${escapeHtml(entry.fingerprint)}</div>
          <span class="muted">${escapeHtml(entry.signingKeyType || "?")}/${escapeHtml(entry.encryptionKeyType || "?")}</span>
          <span class="muted">· ${created}</span>
        </div>
        <div class="server-identity-actions">
          ${isAlreadyContact 
            ? '<span class="already-contact">✓ In contacts</span>'
            : `<button class="btn-import-contact secondary" data-fingerprint="${escapeHtml(entry.fingerprint)}">Import as Contact</button>`
          }
        </div>
      `;
      serverIdentitiesList.appendChild(li);
    }
    
    // Add click handlers for import buttons
    serverIdentitiesList.querySelectorAll(".btn-import-contact").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fingerprint = btn.dataset.fingerprint;
        await importServerIdentityAsContact(fingerprint, btn);
      });
    });
  }

  // Update pagination controls
  renderServerIdentitiesPagination();
}

function renderServerIdentitiesPagination() {
  const paginationContainer = document.getElementById("server-identities-pagination");
  const pageInfo = document.getElementById("server-identities-page-info");
  const prevBtn = document.getElementById("server-identities-prev");
  const nextBtn = document.getElementById("server-identities-next");
  
  if (!paginationContainer) return;
  
  const { page, totalPages, total } = state.serverIdentitiesPagination;
  
  // Hide pagination only if there are no results at all
  if (total === 0) {
    paginationContainer.style.display = "none";
    return;
  }
  
  paginationContainer.style.display = "flex";
  
  // Show more informative text
  if (totalPages <= 1) {
    pageInfo.textContent = `${total} ${total === 1 ? 'identity' : 'identities'}`;
  } else {
    pageInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  }
  
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
}

async function importServerIdentityAsContact(fingerprint, btn) {
  if (btn) setButtonLoading(btn, true);
  try {
    await api("/fetch", {
      method: "POST",
      body: JSON.stringify({ fingerprint }),
    });
    setStatus(`Imported ${fingerprint.substring(0, 16)}... as contact`, "success");
    await loadAll();
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

async function loadServerIdentities(page = 1, serverOverride = null, searchQuery = "") {
  try {
    const serverUrl = serverOverride || "";
    const queryParams = new URLSearchParams();
    queryParams.set("page", String(page));
    if (serverUrl) queryParams.set("server", serverUrl);
    if (searchQuery) queryParams.set("query", searchQuery);
    
    const res = await api(`/server/identities?${queryParams.toString()}`);
    state.serverIdentities = res.identities ?? [];
    
    // Extract pagination info
    if (res.pagination) {
      state.serverIdentitiesPagination = {
        page: res.pagination.page ?? page,
        totalPages: res.pagination.totalPages ?? 1,
        total: res.pagination.total ?? state.serverIdentities.length,
      };
    } else {
      state.serverIdentitiesPagination = { page: 1, totalPages: 1, total: state.serverIdentities.length };
    }
  } catch (err) {
    state.serverIdentities = [];
    state.serverIdentitiesPagination = { page: 1, totalPages: 1, total: 0 };
    console.warn("Failed to load server identities", err);
  }
}

function updateVerifyResult(elementId, status, verifyStatus) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.className = "result-badge";
  
  if (verifyStatus === "valid") {
    el.classList.add("valid");
    el.textContent = "✓ Valid";
  } else if (verifyStatus === "valid_unknown_signer") {
    el.classList.add("warning");
    el.textContent = "⚠ Valid (unknown signer)";
  } else if (status === false && verifyStatus === "invalid") {
    el.classList.add("invalid");
    el.textContent = "✗ Invalid";
  } else if (verifyStatus === "unsigned") {
    el.classList.add("warning");
    el.textContent = "No signature";
  } else if (verifyStatus === "sender_not_specified") {
    el.classList.add("warning");
    el.textContent = "Sender not specified";
  } else if (verifyStatus === "sender_not_found" || verifyStatus === "sender_not_in_contacts") {
    el.classList.add("warning");
    el.textContent = "Sender not in contacts";
  } else if (status === false) {
    el.classList.add("invalid");
    el.textContent = "✗ Invalid";
  } else {
    el.classList.add("pending");
    el.textContent = "-";
  }
}

function setResultBadge(elementId, kind, text) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = "result-badge";
  if (kind === "valid") {
    el.classList.add("valid");
  } else if (kind === "invalid") {
    el.classList.add("invalid");
  } else if (kind === "warning") {
    el.classList.add("warning");
  } else {
    el.classList.add("pending");
  }
  el.textContent = text;
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function extractEbpPayloadFromText(text) {
  const start = "-----BEGIN EBP MESSAGE-----";
  const end = "-----END EBP MESSAGE-----";
  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);
  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null;
  const raw = text.slice(startIdx + start.length, endIdx).trim();
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractEmailAddress(text) {
  const raw = (text || "").trim();
  const angle = raw.match(/<([^>]+)>/);
  const candidate = angle ? angle[1] : raw;
  const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function renderMailVerifyMeta(result) {
  const metaEl = document.getElementById("mail-verify-meta");
  if (!metaEl) return;
  if (!result) {
    metaEl.textContent = "";
    return;
  }
  const lines = [];
  if (result.signerFingerprint) lines.push(`Signer fingerprint: ${result.signerFingerprint}`);
  if (result.signerEmail) lines.push(`Signer email detail: ${result.signerEmail}`);
  if (typeof result.signerEmailVerified === "boolean") {
    lines.push(`Signer email verified: ${result.signerEmailVerified ? "yes" : "no"}`);
  }
  if (typeof result.signerMatchesSenderEmail === "boolean") {
    lines.push(`Signer email matches sender address: ${result.signerMatchesSenderEmail ? "yes" : "no"}`);
  }
  metaEl.textContent = lines.join(" • ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    setStatus("Loading…");
    let startupError = null;
    for (let attempt = 1; attempt <= STARTUP_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const [health, ctx, ids, contacts] = await Promise.all([
          api("/health"),
          api("/context"),
          api("/identities"),
          api("/contacts"),
        ]);
        startupError = null;
        state.currentIdentity = ids?.currentIdentity ?? ctx?.currentIdentity ?? null;
        state.server = ctx?.server ?? null;
        state.identityDir = ctx?.identityDir ?? "";
        state.protocolVersion = ctx?.protocolVersion ?? null;
        state.identities = ids?.identities ?? [];
        state.contacts = contacts?.contacts ?? [];
        break;
      } catch (err) {
        startupError = err;
        if (attempt < STARTUP_RETRY_ATTEMPTS) {
          setStatus(`Starting local backend… (${attempt}/${STARTUP_RETRY_ATTEMPTS})`);
          await sleep(STARTUP_RETRY_DELAY_MS);
        }
      }
    }
    if (startupError) throw startupError;
    
    renderContext();
    renderContacts();
    
    // Load server identities first (to know which local identities are published)
    if (state.server) {
      await loadServerIdentities(1, null, state.serverIdentitiesSearch);
    } else {
      state.serverIdentities = [];
      state.serverIdentitiesPagination = { page: 1, totalPages: 1, total: 0 };
    }
    
    // Now render identities (needs serverIdentities to show published status)
    renderIdentities();
    
    // Load public identity info (fingerprint) - no password required
    if (state.currentIdentity) {
      await loadPublicIdentityInfo();
    } else {
      state.currentFingerprint = null;
      renderFingerprint();
    }

    // Populate server URL input if we have a server
    const serverUrlInput = document.getElementById("server-url");
    const serverUrlPreset = document.getElementById("server-url-preset");
    if (state.server) {
      if (serverUrlInput) serverUrlInput.value = state.server;
      if (serverUrlPreset) serverUrlPreset.value = state.server;
    } else if (!serverDefaultApplied) {
      if (serverUrlInput) serverUrlInput.value = DEFAULT_SERVER_URL;
      if (serverUrlPreset) serverUrlPreset.value = DEFAULT_SERVER_URL;
      serverDefaultApplied = true;
    }
    const serverIdentitiesSearchInput = document.getElementById("server-identities-search");
    if (serverIdentitiesSearchInput) {
      serverIdentitiesSearchInput.value = state.serverIdentitiesSearch;
    }

    // Render server identities (already loaded above)
    renderServerIdentities();
    await renderHierarchyList();
    await loadMailAccount();
    await loadStoredMailCredentials();
    renderStoredMailCredentials();

    setStatus("Ready", "success");
  } catch (e) {
    const base = e?.message ? String(e.message) : String(e);
    setStatus(`Load failed: ${base} (backend: ${LOCAL_BACKEND_ORIGIN})`, "error");
    console.error("loadAll failed", e);
  }
}

async function loadMailAccount() {
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
    if (oauthStatus) oauthStatus.textContent = `Opening ${provider} OAuth sign-in...`;
    const popup = window.open(start.authUrl, "ebpMailOAuth", "width=560,height=740");
    if (!popup) {
      throw new Error("Popup blocked by browser. Please allow popups and try again.");
    }
  } catch (err) {
    if (oauthStatus) oauthStatus.textContent = err.message || "OAuth start failed";
    throw err;
  }
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

async function ensureMailPageUnlocked() {
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

async function loadStoredMailCredentials() {
  try {
    const res = await api("/mail/accounts");
    state.settingsMailCredentials = res?.accounts || [];
    if (typeof res?.secretsInMemory === "boolean") state.mailSecretsInMemory = res.secretsInMemory;
    if (typeof res?.secretsLocked === "boolean") state.mailSecretsLocked = res.secretsLocked;
  } catch {
    state.settingsMailCredentials = [];
  }
}

function renderStoredMailCredentials() {
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
      } catch (err) {
        if (requestId !== state.mailMessageLoadRequestId) return;
        setMailMessageLoading(false);
        setStatus(err.message, "error");
      }
    });
    list.appendChild(li);
  }
}

async function loadMailMessages(page = 1) {
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

function initMailPage() {
  initMailTabs();
  renderMailReaderHeader();
  syncMailFolderCustomUi();

  const folderEl = document.getElementById("mail-folder");
  if (folderEl) {
    folderEl.addEventListener("change", () => {
      syncMailFolderCustomUi();
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

// ─────────────────────────────────────────────────────────────────────────────
// Form handlers
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById("server-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const url = document.getElementById("server-url").value.trim();
  await withLoading(btn, async () => {
    try {
      await api("/server", { method: "POST", body: JSON.stringify({ url }) });
      setStatus("Server set", "success");
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("server-clear").addEventListener("click", async (e) => {
  const btn = e.target;
  await withLoading(btn, async () => {
    try {
      await api("/server", { method: "POST", body: JSON.stringify({ clear: true }) });
      document.getElementById("server-url").value = "";
      const preset = document.getElementById("server-url-preset");
      if (preset) preset.value = "";
      setStatus("Server cleared", "success");
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

const serverUrlPreset = document.getElementById("server-url-preset");
if (serverUrlPreset) {
  serverUrlPreset.addEventListener("change", () => {
    const presetValue = serverUrlPreset.value;
    const serverUrlInput = document.getElementById("server-url");
    if (!serverUrlInput) return;
    if (presetValue) {
      serverUrlInput.value = presetValue;
    }
    serverUrlInput.focus();
  });
}

document.getElementById("generate-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const name = document.getElementById("gen-name").value.trim();
  const signingType = document.getElementById("gen-signing").value;
  const force = document.getElementById("gen-force").checked;
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter a password to secure this identity");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      await api("/identity/generate", {
        method: "POST",
        body: JSON.stringify({ name, signingType, encryptionType: "kyber", password, force }),
      });
      setStatus("Identity generated", "success");
      document.getElementById("gen-name").value = "";
      document.getElementById("gen-force").checked = false;
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("export-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to export your public identity");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      const res = await api("/identity/export-public", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      document.getElementById("export-output").value = JSON.stringify(res, null, 2);
      setStatus("Exported", "success");
      // Reload to pick up any format migration
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const raw = document.getElementById("contact-json").value;
  const name = document.getElementById("contact-name").value.trim();
  await withLoading(btn, async () => {
    try {
      const contact = JSON.parse(raw);
      await api("/contacts/import", { method: "POST", body: JSON.stringify({ contact, name }) });
      setStatus("Contact imported", "success");
      document.getElementById("contact-json").value = "";
      document.getElementById("contact-name").value = "";
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("fetch-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const fingerprint = document.getElementById("fetch-fp").value.trim();
  const name = document.getElementById("fetch-name").value.trim();
  const server = document.getElementById("fetch-server").value.trim();
  await withLoading(btn, async () => {
    try {
      await api("/fetch", {
        method: "POST",
        body: JSON.stringify({ fingerprint, name: name || undefined, server: server || undefined }),
      });
      setStatus("Contact fetched", "success");
      document.getElementById("fetch-fp").value = "";
      document.getElementById("fetch-name").value = "";
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("sign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const message = document.getElementById("sign-message").value;
  const detached = document.getElementById("sign-detached").checked;
  const includeSalt = document.getElementById("sign-include-salt").checked;
  const includeIdentity = document.getElementById("sign-include-identity").checked;
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to sign this message");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      const res = await api("/sign", {
        method: "POST",
        body: JSON.stringify({ message, password, detached, includeIdentity, includeSalt }),
      });
      document.getElementById("sign-output").value = JSON.stringify(res, null, 2);
      setStatus("Signed", "success");
      // Reload to pick up any format migration (and update fingerprint)
      await loadPublicIdentityInfo();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("verify-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const payloadRaw = document.getElementById("verify-payload").value;
  const message = document.getElementById("verify-message").value;
  const usePublicKeys = document.getElementById("verify-use-public-keys").checked;
  const publicKeysRaw = document.getElementById("verify-public-keys").value;
  const sender = document.getElementById("verify-sender").value.trim();
  await withLoading(btn, async () => {
    try {
      const payload = JSON.parse(payloadRaw);
      const publicIdentity = usePublicKeys && publicKeysRaw.trim().length > 0
        ? JSON.parse(publicKeysRaw)
        : undefined;
      const res = await api("/verify", {
        method: "POST",
        body: JSON.stringify({
          payload,
          message: message || undefined,
          sender: sender || undefined,
          publicIdentity
        }),
      });
      updateVerifyResult("verify-result", res.verified, res.verified ? "valid" : "invalid");
      setStatus("Verified", "success");
    } catch (err) {
      setStatus(err.message, "error");
      updateVerifyResult("verify-result", null, null);
    }
  });
});

document.getElementById("sign-file-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const fileInput = document.getElementById("sign-file-input");
  const includeSalt = document.getElementById("sign-file-include-salt").checked;
  const saltOutput = document.getElementById("sign-file-salt");
  const contextMessage = document.getElementById("sign-file-context").value;
  const hashOutput = document.getElementById("sign-file-hash");
  const payloadOutput = document.getElementById("sign-file-output");
  const file = fileInput?.files?.[0];

  await withLoading(btn, async () => {
    try {
      if (!file) {
        throw new Error("Please select a file to sign");
      }
      const fileHash = await hashFileSha256Hex(file);
      hashOutput.value = fileHash;
      const salt = includeSalt ? generateRandomSaltHex() : "";
      saltOutput.value = salt;
      const message = buildFileSignMessage(fileHash, salt, contextMessage);

      const password = await requestPassword("Enter password to sign this file hash");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }

      const signRes = await api("/sign", {
        method: "POST",
        body: JSON.stringify({
          message,
          password,
          detached: true,
          includeIdentity: true,
          includeSalt: false,
        }),
      });

      if (!signRes?.signature || !signRes?.identity) {
        throw new Error("Signing response missing signature or public identity");
      }

      const signedFilePayload = {
        type: "ebp-signed-file",
        fileName: file.name,
        fileHash,
        salt,
        contextMessage: contextMessage || "",
        fingerprint: signRes.fingerprint,
        signature: signRes.signature,
        identity: signRes.identity,
      };
      payloadOutput.value = JSON.stringify(signedFilePayload, null, 2);
      setStatus("File hash signed", "success");
      await loadPublicIdentityInfo();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("verify-file-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const fileInput = document.getElementById("verify-file-input");
  const payloadRaw = document.getElementById("verify-file-payload").value;
  const detailsOutput = document.getElementById("verify-file-details");
  const signedMessageOutput = document.getElementById("verify-file-signed-message");
  const file = fileInput?.files?.[0];

  await withLoading(btn, async () => {
    try {
      if (!file) {
        throw new Error("Please select the file to verify");
      }
      if (!payloadRaw.trim()) {
        throw new Error("Signature JSON is required");
      }

      const payload = JSON.parse(payloadRaw);
      if (!payload || typeof payload !== "object") {
        throw new Error("Signature payload must be a JSON object");
      }
      if (payload.type !== "ebp-signed-file") {
        throw new Error('Signature payload type must be "ebp-signed-file"');
      }

      const expectedHash = typeof payload.fileHash === "string" ? payload.fileHash : "";
      if (!expectedHash) {
        throw new Error("Signature payload missing fileHash");
      }
      const signature = typeof payload.signature === "string" ? payload.signature : "";
      if (!signature) {
        throw new Error("Signature payload missing signature");
      }
      const identity = payload.identity;
      if (!identity || typeof identity !== "object") {
        throw new Error("Signature payload missing identity public keys");
      }

      const computedHash = await hashFileSha256Hex(file);
      const salt = typeof payload.salt === "string" ? payload.salt : "";
      const contextMessage = typeof payload.contextMessage === "string" ? payload.contextMessage : "";
      const reconstructedMessage = buildFileSignMessage(computedHash, salt, contextMessage);

      if (detailsOutput) detailsOutput.value = "";
      if (signedMessageOutput) signedMessageOutput.value = "";

      if (computedHash !== expectedHash) {
        setResultBadge("verify-file-result", "invalid", "✗ Invalid");
        if (detailsOutput) {
          detailsOutput.value = [
            "File hash mismatch.",
            `Expected (from signature): ${expectedHash}`,
            `Computed (uploaded file): ${computedHash}`,
            "Verification stopped before key and signature checks."
          ].join("\n");
        }
        setStatus("File hash mismatch", "error");
        return;
      }

      const computedFingerprintRes = await api("/identity/fingerprint-from-public", {
        method: "POST",
        body: JSON.stringify({ publicIdentity: identity }),
      });
      const computedFingerprint = typeof computedFingerprintRes?.fingerprint === "string"
        ? computedFingerprintRes.fingerprint
        : "";
      const payloadFingerprint = typeof payload.fingerprint === "string" ? payload.fingerprint : "";
      const identityFingerprint = typeof identity.fingerprint === "string" ? identity.fingerprint : "";

      if (payloadFingerprint && identityFingerprint && payloadFingerprint !== identityFingerprint) {
        setResultBadge("verify-file-result", "invalid", "✗ Invalid");
        if (detailsOutput) {
          detailsOutput.value = [
            "Fingerprint mismatch inside signature JSON.",
            `payload.fingerprint: ${payloadFingerprint}`,
            `identity.fingerprint: ${identityFingerprint}`,
            "Verification stopped before signature check."
          ].join("\n");
        }
        setStatus("Fingerprint mismatch in signature JSON", "error");
        return;
      }

      const expectedFingerprint = payloadFingerprint || identityFingerprint;
      if (!expectedFingerprint) {
        setResultBadge("verify-file-result", "invalid", "✗ Invalid");
        if (detailsOutput) {
          detailsOutput.value = "Fingerprint missing from signature JSON (expected on payload or identity object).";
        }
        setStatus("Missing fingerprint in signature payload", "error");
        return;
      }

      if (computedFingerprint !== expectedFingerprint) {
        setResultBadge("verify-file-result", "invalid", "✗ Invalid");
        if (detailsOutput) {
          detailsOutput.value = [
            "Public keys do not match the expected fingerprint.",
            `Expected fingerprint: ${expectedFingerprint}`,
            `Computed from provided keys: ${computedFingerprint}`,
            "Verification stopped before signature check."
          ].join("\n");
        }
        setStatus("Public keys do not match fingerprint", "error");
        return;
      }

      const verifyRes = await api("/verify", {
        method: "POST",
        body: JSON.stringify({
          payload: {
            type: "ebp-signature",
            messageHash: await hashTextSha256Hex(reconstructedMessage),
            salt: "",
            signature,
            fingerprint: expectedFingerprint,
          },
          message: reconstructedMessage,
          publicIdentity: identity,
        }),
      });

      if (!verifyRes?.verified) {
        setResultBadge("verify-file-result", "invalid", "✗ Invalid");
        if (detailsOutput) {
          detailsOutput.value = [
            "Signature verification failed.",
            "File hash and fingerprint checks passed, but the signature is not valid for the reconstructed message."
          ].join("\n");
        }
        setStatus("Signature verification failed", "error");
        return;
      }

      setResultBadge("verify-file-result", "valid", "✓ Valid");
      if (detailsOutput) {
        detailsOutput.value = [
          "Verification succeeded.",
          `File hash: ${computedHash}`,
          `Signer fingerprint: ${expectedFingerprint}`
        ].join("\n");
      }
      if (signedMessageOutput) {
        signedMessageOutput.value = reconstructedMessage;
      }
      setStatus("File signature verified", "success");
    } catch (err) {
      setResultBadge("verify-file-result", "invalid", "✗ Invalid");
      if (detailsOutput) detailsOutput.value = err.message;
      if (signedMessageOutput) signedMessageOutput.value = "";
      setStatus(err.message, "error");
    }
  });
});

const verifyPublicKeysToggle = document.getElementById("verify-use-public-keys");
if (verifyPublicKeysToggle) {
  verifyPublicKeysToggle.addEventListener("change", (e) => {
    const wrapper = document.getElementById("verify-public-keys-wrapper");
    if (!wrapper) return;
    wrapper.style.display = e.target.checked ? "block" : "none";
  });
}

document.getElementById("encrypt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const message = document.getElementById("enc-message").value;
  const recipient = document.getElementById("enc-recipient").value.trim();
  const sign = document.getElementById("enc-sign").checked;
  await withLoading(btn, async () => {
    try {
      const body = { message, recipient, sign };
      if (sign) {
        const password = await requestPassword("Enter password to sign this message");
        if (!password) {
          setStatus("Password is required to sign", "error");
          return;
        }
        body.password = password;
      }
      const res = await api("/encrypt", { method: "POST", body: JSON.stringify(body) });
      document.getElementById("enc-output").value = JSON.stringify(res, null, 2);
      setStatus("Encrypted", "success");
      // If signed, reload to pick up any format migration
      if (sign) {
        await loadPublicIdentityInfo();
      }
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("decrypt-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const payloadRaw = document.getElementById("dec-payload").value;
  const sender = document.getElementById("dec-sender").value.trim();
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to decrypt");
      if (!password) {
        setStatus("Password is required", "error");
        updateVerifyResult("dec-verified", null, null);
        return;
      }
      const payload = JSON.parse(payloadRaw);
      const res = await api("/decrypt", {
        method: "POST",
        body: JSON.stringify({ payload, password, sender: sender || undefined }),
      });
      document.getElementById("dec-output").value = res.message ?? "";
      updateVerifyResult("dec-verified", res.verified, res.verifyStatus);
      setStatus("Decrypted", "success");
    } catch (err) {
      setStatus(err.message, "error");
      updateVerifyResult("dec-verified", null, null);
    }
  });
});

document.getElementById("encrypt-file-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const fileInput = document.getElementById("enc-file-input");
  const recipient = document.getElementById("enc-file-recipient").value.trim();
  const sign = document.getElementById("enc-file-sign").checked;
  const file = fileInput?.files?.[0];
  await withLoading(btn, async () => {
    try {
      if (!file) throw new Error("Please select a file to encrypt");
      if (!recipient) throw new Error("Recipient is required");
      const fileDataBase64 = await readFileAsBase64(file);
      const body = {
        recipient,
        sign,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        fileDataBase64,
      };
      if (sign) {
        const password = await requestPassword("Enter password to sign encrypted file payload");
        if (!password) {
          setStatus("Password is required to sign", "error");
          return;
        }
        body.password = password;
      }
      const res = await api("/encrypt-file", { method: "POST", body: JSON.stringify(body) });
      document.getElementById("enc-file-output").value = JSON.stringify(res, null, 2);
      setStatus("File encrypted", "success");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("decrypt-file-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const payloadRaw = document.getElementById("dec-file-payload").value;
  const sender = document.getElementById("dec-file-sender").value.trim();
  const info = document.getElementById("dec-file-info");
  const downloadBtn = document.getElementById("dec-file-download-btn");
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to decrypt file payload");
      if (!password) {
        setStatus("Password is required", "error");
        updateVerifyResult("dec-file-verified", null, null);
        return;
      }
      const payload = JSON.parse(payloadRaw);
      const res = await api("/decrypt-file", {
        method: "POST",
        body: JSON.stringify({ payload, password, sender: sender || undefined }),
      });
      decryptedFileResult = res;
      if (downloadBtn) downloadBtn.disabled = false;
      if (info) {
        info.value = `${res.fileName || "decrypted.bin"} (${res.fileSize || 0} bytes, ${res.mimeType || "application/octet-stream"})`;
      }
      updateVerifyResult("dec-file-verified", res.verified, res.verifyStatus);
      setStatus("File decrypted payload ready for download", "success");
    } catch (err) {
      decryptedFileResult = null;
      if (downloadBtn) downloadBtn.disabled = true;
      if (info) info.value = "";
      updateVerifyResult("dec-file-verified", null, null);
      setStatus(err.message, "error");
    }
  });
});

const decFileDownloadBtn = document.getElementById("dec-file-download-btn");
if (decFileDownloadBtn) {
  decFileDownloadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    if (!decryptedFileResult?.fileDataBase64) {
      setStatus("No decrypted file available to download", "error");
      return;
    }
    const bytes = base64ToUint8Array(decryptedFileResult.fileDataBase64);
    const blob = new Blob([bytes], { type: decryptedFileResult.mimeType || "application/octet-stream" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = safeDownloadFileName(decryptedFileResult.fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
}


document.getElementById("publish-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const server = document.getElementById("publish-server").value.trim();
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to publish your identity");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      await api("/publish", { method: "POST", body: JSON.stringify({ password, server: server || undefined }) });
      setStatus("Published", "success");
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("add-detail-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const path = document.getElementById("detail-path").value.trim();
  const detail = document.getElementById("detail-value").value.trim();
  const push = document.getElementById("detail-push").checked;
  
  if (!path || !detail) {
    setStatus("Path and value are required", "error");
    return;
  }
  
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to add this detail");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      await api("/detail", {
        method: "POST",
        body: JSON.stringify({ path, detail, password, push }),
      });
      setStatus(`Detail "${path}" added${push ? " and pushed to server" : ""}`, "success");
      document.getElementById("detail-path").value = "";
      document.getElementById("detail-value").value = "";
      // Reload to show updated details
      await loadPublicIdentityInfo();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("hierarchy-create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const role = document.getElementById("hierarchy-role-master").checked ? "master" : "child";
  const otherInput = document.getElementById("hierarchy-other-fingerprint").value.trim();
  const otherFingerprint = resolveHierarchyFingerprint(otherInput);
  const context = document.getElementById("hierarchy-context").value.trim();
  const expiryRaw = document.getElementById("hierarchy-expiry").value;
  const expiry = expiryRaw ? new Date(`${expiryRaw}T00:00:00`).getTime() : 0;

  if (!state.currentFingerprint) {
    setStatus("Current identity fingerprint is unavailable", "error");
    return;
  }
  if (!otherFingerprint) {
    setStatus("Other party fingerprint is required", "error");
    return;
  }

  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to create and sign hierarchy certificate");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }

      const masterFingerprint = role === "master" ? state.currentFingerprint : otherFingerprint;
      const childFingerprint = role === "master" ? otherFingerprint : state.currentFingerprint;
      const created = await api("/hierarchy/create", {
        method: "POST",
        body: JSON.stringify({ masterFingerprint, childFingerprint, context, expiry }),
      });
      const signed = await api("/hierarchy/sign", {
        method: "POST",
        body: JSON.stringify({ certificate: created.certificate, password }),
      });
      document.getElementById("hierarchy-create-output").value = signed.certificate || "";
      setStatus("Hierarchy certificate created and signed. Share it for co-signing.", "success");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("hierarchy-cosign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const publishBtn = document.getElementById("hierarchy-cosign-publish-btn");
  const input = document.getElementById("hierarchy-cosign-input").value.trim();
  if (!input) {
    setStatus("Incoming certificate is required", "error");
    return;
  }
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to co-sign hierarchy certificate");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }

      const signed = await api("/hierarchy/sign", {
        method: "POST",
        body: JSON.stringify({ certificate: input, password }),
      });
      document.getElementById("hierarchy-cosign-output").value = signed.certificate || "";
      if (signed.complete) {
        await api("/hierarchy/import", {
          method: "POST",
          body: JSON.stringify({ certificate: signed.certificate }),
        });
        publishBtn.dataset.certificate = signed.certificate;
        publishBtn.style.display = "";
        await renderHierarchyList();
        setStatus("Hierarchy certificate co-signed and imported. Publish when ready.", "success");
      } else {
        publishBtn.style.display = "none";
        publishBtn.dataset.certificate = "";
        setStatus("Certificate signed but still missing one signature.", "info");
      }
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("hierarchy-cosign-publish-btn").addEventListener("click", async (e) => {
  const btn = e.target;
  const certificate = btn.dataset.certificate || document.getElementById("hierarchy-cosign-output").value.trim();
  await withLoading(btn, async () => {
    try {
      await handlePublishHierarchy(certificate);
      setStatus("Hierarchy certificate published", "success");
      await renderHierarchyList();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("hierarchy-import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const certificate = document.getElementById("hierarchy-import-input").value.trim();
  if (!certificate) {
    setStatus("Certificate is required", "error");
    return;
  }
  await withLoading(btn, async () => {
    try {
      await api("/hierarchy/import", {
        method: "POST",
        body: JSON.stringify({ certificate }),
      });
      setStatus("Hierarchy certificate imported", "success");
      document.getElementById("hierarchy-import-input").value = "";
      await renderHierarchyList();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("server-identities-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const serverOverride = document.getElementById("server-identities-override").value.trim();
  await withLoading(btn, async () => {
    try {
      await loadServerIdentities(1, serverOverride || null, state.serverIdentitiesSearch);
      renderServerIdentities();
      setStatus("Server identities refreshed", "success");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

// Pagination handlers for server identities
document.getElementById("server-identities-prev").addEventListener("click", async () => {
  const { page } = state.serverIdentitiesPagination;
  if (page <= 1) return;
  const serverOverride = document.getElementById("server-identities-override").value.trim();
  setStatus("Loading...");
  await loadServerIdentities(page - 1, serverOverride || null, state.serverIdentitiesSearch);
  renderServerIdentities();
  setStatus("Ready", "success");
});

document.getElementById("server-identities-next").addEventListener("click", async () => {
  const { page, totalPages } = state.serverIdentitiesPagination;
  if (page >= totalPages) return;
  const serverOverride = document.getElementById("server-identities-override").value.trim();
  setStatus("Loading...");
  await loadServerIdentities(page + 1, serverOverride || null, state.serverIdentitiesSearch);
  renderServerIdentities();
  setStatus("Ready", "success");
});

// ─────────────────────────────────────────────────────────────────────────────
// Revocation
// ─────────────────────────────────────────────────────────────────────────────

function updateRevokeDetailPathOptions() {
  const select = document.getElementById("revoke-detail-path");
  if (!select) return;
  
  select.innerHTML = '<option value="">Select a detail to revoke...</option>';
  
  const details = Array.isArray(state.currentDetails) 
    ? state.currentDetails 
    : Object.entries(state.currentDetails || {}).map(([path, val]) => ({
        path,
        detail: Array.isArray(val) ? val[0] : val
      }));
  
  for (const item of details) {
    const option = document.createElement("option");
    option.value = item.path;
    option.textContent = `${item.path}: ${item.detail}`;
    select.appendChild(option);
  }
}

function updateRevocationStatus(isRevoked) {
  const statusDiv = document.getElementById("revocation-status");
  const actionsDiv = document.getElementById("revocation-actions");
  const revokeIdentityForm = document.getElementById("revoke-identity-form");
  
  if (isRevoked) {
    statusDiv.style.display = "block";
    // Hide the revoke identity form since already revoked
    if (revokeIdentityForm) {
      revokeIdentityForm.closest("details").style.display = "none";
    }
  } else {
    statusDiv.style.display = "none";
    if (revokeIdentityForm) {
      revokeIdentityForm.closest("details").style.display = "block";
    }
  }
}

document.getElementById("revoke-detail-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const path = document.getElementById("revoke-detail-path").value;
  const reason = document.getElementById("revoke-detail-reason").value.trim();
  const push = document.getElementById("revoke-detail-push").checked;
  
  if (!path) {
    setStatus("Please select a detail to revoke", "error");
    return;
  }
  
  const confirmed = await showConfirmModal(
    "Revoke Detail",
    `Are you sure you want to revoke the detail "${path}"? This action is irreversible.`,
    "Revoke"
  );
  
  if (!confirmed) return;
  
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to revoke this detail");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      await api("/revoke/detail", {
        method: "POST",
        body: JSON.stringify({ path, reason: reason || undefined, password, push }),
      });
      setStatus(`Detail "${path}" revoked${push ? " and pushed to server" : ""}`, "success");
      document.getElementById("revoke-detail-path").value = "";
      document.getElementById("revoke-detail-reason").value = "";
      await loadPublicIdentityInfo();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("emergency-cert-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to generate the emergency certificate");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      const res = await api("/revoke/emergency-cert", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      document.getElementById("emergency-cert-output").value = JSON.stringify(res, null, 2);
      setStatus("Emergency certificate generated - store it securely!", "success");
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

document.getElementById("revoke-identity-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const reason = document.getElementById("revoke-identity-reason").value.trim();
  const push = document.getElementById("revoke-identity-push").checked;
  
  const confirmed = await showConfirmModal(
    "⚠️ Revoke Identity",
    "This will permanently mark your identity as compromised. This action is IRREVERSIBLE. Are you absolutely sure?",
    "Yes, Revoke My Identity"
  );
  
  if (!confirmed) return;
  
  // Double confirmation for such a dangerous action
  const doubleConfirmed = await showConfirmModal(
    "Final Confirmation",
    "You are about to revoke your identity. Type 'REVOKE' in your mind and click confirm if you're certain.",
    "I Understand, Revoke"
  );
  
  if (!doubleConfirmed) return;
  
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword("Enter password to revoke your identity");
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      await api("/revoke/identity", {
        method: "POST",
        body: JSON.stringify({ reason: reason || undefined, password, push }),
      });
      setStatus(`Identity revoked${push ? " and pushed to server" : ""}`, "success");
      document.getElementById("revoke-identity-reason").value = "";
      await loadPublicIdentityInfo();
    } catch (err) {
      setStatus(err.message, "error");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────────────────────

loadUiPreferences();
initNavigation();
initCollapsibleSections();
initContactSearch();
initMailPage();
loadAll();
