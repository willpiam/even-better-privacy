const statusEl = document.getElementById("status");
const DEFAULT_SERVER_URL = "https://ebp-cqyo.onrender.com";
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
  serverIdentitiesPagination: { page: 1, totalPages: 1, total: 0 },
  serverIdentitiesSearch: "",
  identityDir: "",
  isRevoked: false,
  revokedDetails: [],
};

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

function getPayloadDownloadName(payload, fallback) {
  if (!payload || typeof payload !== "object") return fallback;
  switch (payload.type) {
    case "ebp-signature":
      return "ebp-signature.json";
    case "ebp-signed-message":
      return "ebp-signed-message.json";
    case "ebp-encrypted-message":
      return "ebp-encrypted-message.json";
    case "ebp-encrypted-signed-message":
      return "ebp-encrypted-signed-message.json";
    default:
      return fallback;
  }
}

function downloadJsonFromTextarea(textareaId, fallbackName) {
  const textarea = document.getElementById(textareaId);
  if (!textarea || !textarea.value) return;

  try {
    const payload = JSON.parse(textarea.value);
    const filename = getPayloadDownloadName(payload, fallbackName);
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
  signDownloadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    downloadJsonFromTextarea("sign-output", "ebp-signed-message.json");
  });
}

const encDownloadBtn = document.getElementById("enc-download-btn");
if (encDownloadBtn) {
  encDownloadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    downloadJsonFromTextarea("enc-output", "ebp-encrypted-message.json");
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

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

async function api(path, init = {}) {
  const res = await fetch(`/api/v1${path}`, {
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

// ─────────────────────────────────────────────────────────────────────────────
// Contact Search Autocomplete
// ─────────────────────────────────────────────────────────────────────────────

const contactSearchFields = [
  { inputId: "enc-recipient", dropdownId: "enc-recipient-dropdown" },
  { inputId: "verify-sender", dropdownId: "verify-sender-dropdown" },
  { inputId: "dec-sender", dropdownId: "dec-sender-dropdown" },
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
  // Use the contact name as the value (the backend resolves by name or fingerprint)
  input.value = contact.name;
  closeAllDropdowns();
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

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ─────────────────────────────────────────────────────────────────────────────
// Data loading
// ─────────────────────────────────────────────────────────────────────────────

async function loadAll() {
  try {
    setStatus("Loading…");
    const [health, ctx, ids, contacts] = await Promise.all([
      api("/health"),
      api("/context"),
      api("/identities"),
      api("/contacts"),
    ]);
    state.currentIdentity = ids.currentIdentity ?? ctx.currentIdentity ?? null;
    state.server = ctx.server ?? null;
    state.identityDir = ctx.identityDir ?? "";
    state.protocolVersion = ctx.protocolVersion ?? null;
    state.identities = ids.identities ?? [];
    state.contacts = contacts.contacts ?? [];
    
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

    setStatus("Ready", "success");
  } catch (e) {
    setStatus(e.message, "error");
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
        body: JSON.stringify({ message, password, detached, includeIdentity }),
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

initNavigation();
initContactSearch();
loadAll();
