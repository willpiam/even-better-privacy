import { state, getDetailValue, getDetailMeta, isOpaqueDetailPath, formatOpaqueHash, DEFAULT_SERVER_URL, LOCAL_BACKEND_ORIGIN, STARTUP_RETRY_ATTEMPTS, STARTUP_RETRY_DELAY_MS } from "./state.js";
import { api, sleep, setStatus, setButtonLoading, escapeHtml } from "./ui.js";
import { showConfirmModal, requestPassword, requestTextInput } from "./modals.js";
import { updateRevokeDetailPathOptions, updateRevocationStatus } from "./revocation.js";
import { renderHierarchyTreeSVG, loadContactHierarchyDiagram, renderCertificatesPage } from "./hierarchy.js";

const ctxCurrent = document.getElementById("ctx-current");
const ctxServer = document.getElementById("ctx-server");
const ctxIdir = document.getElementById("ctx-idir");
const ctxFingerprint = document.getElementById("ctx-fingerprint");
const ctxFingerprintContainer = document.getElementById("ctx-fingerprint-container");
const identityList = document.getElementById("identity-list");
const identityDetailsList = document.getElementById("identity-details-list");
const contactsList = document.getElementById("contacts-list");
const serverIdentitiesList = document.getElementById("server-identities-list");
const settingsLogsList = document.getElementById("settings-logs-list");

export function updateCurrentFingerprint(fingerprint) {
  state.currentFingerprint = fingerprint;
  renderFingerprint();
}

export function renderFingerprint() {
  if (state.currentFingerprint) {
    ctxFingerprint.textContent = state.currentFingerprint;
    ctxFingerprint.title = state.currentFingerprint;
    ctxFingerprintContainer.style.display = "flex";
  } else {
    ctxFingerprintContainer.style.display = "none";
  }
}

export async function loadPublicIdentityInfo() {
  try {
    const res = await api("/identity/public");
    if (res.available && res.fingerprint) {
      updateCurrentFingerprint(res.fingerprint);
      state.currentDetails = res.details || [];
      state.isRevoked = res.isRevoked || false;
      state.revokedDetails = res.revokedDetails || [];
      
      await loadServerDetailsForCurrentIdentity(res.fingerprint);
      
      renderIdentityDetails();
      updateRevokeDetailPathOptions();
      updateRevocationStatus(state.isRevoked);
    } else {
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

export async function loadServerDetailsForCurrentIdentity(fingerprint) {
  if (!state.server || !fingerprint) {
    state.serverDetails = [];
    state.serverDetailsMeta = {};
    return;
  }
  
  try {
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

export function renderIdentityDetails() {
  if (!identityDetailsList) return;
  identityDetailsList.innerHTML = "";
  
  if (!state.currentDetails || state.currentDetails.length === 0) {
    identityDetailsList.innerHTML = "<li class='muted'>(no details attached)</li>";
    return;
  }
  
  const details = Array.isArray(state.currentDetails) 
    ? state.currentDetails 
    : Object.entries(state.currentDetails).map(([path, val]) => ({
        path,
        detail: Array.isArray(val) ? val[0] : val
      }));
  
  for (const item of details) {
    const li = document.createElement("li");
    li.className = "detail-item";
    const isOpaque = isOpaqueDetailPath(item.path);
    
    const serverDetail = state.serverDetails.find(d => d.path === item.path);
    const isOnServer = serverDetail && serverDetail.detail === item.detail;
    const isLocalOnly = !isOnServer;
    const isEmailDetail = item.path === "email" || item.path === "opaque::email";
    const emailMeta = isEmailDetail && isOnServer
      ? (state.serverDetailsMeta?.[item.path] || null)
      : null;
    const emailMarker = emailMeta?.verified
      ? '<span class="email-verified" title="Email verified">●</span>'
      : "";
    const emailAction = isEmailDetail && isOnServer && !emailMeta?.verified
      ? `<button class="btn-verify-email secondary" data-email="${escapeHtml(isOpaque ? "" : item.detail)}" data-path="${escapeHtml(item.path)}">Send verification link</button>`
      : "";
    
    li.innerHTML = `
      <div class="detail-item-content">
        <div class="detail-text">
          <strong>${escapeHtml(item.path)}</strong>:
          <span class="detail-value" title="${escapeHtml(item.detail)}">${escapeHtml(isOpaque ? formatOpaqueHash(item.detail) : item.detail)}</span>
          ${isOpaque ? '<span class="muted small" title="Opaque detail: only hash is public">Opaque</span>' : ""}
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
  
  identityDetailsList.querySelectorAll(".btn-push-detail").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const path = btn.dataset.path;
      await showPushDetailModal(path, btn);
    });
  });

  identityDetailsList.querySelectorAll(".btn-verify-email").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = btn.dataset.email;
      const path = btn.dataset.path || "email";
      await requestEmailVerification(email, btn, path);
    });
  });
}

export async function showPushDetailModal(path, btn) {
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

export async function requestEmailVerification(email, btn, path = "email") {
  if (!state.server) {
    setStatus("No server configured for verification", "error");
    return;
  }

  let cleartext = email;
  if (path === "opaque::email") {
    cleartext = await requestTextInput(
      "Enter the cleartext email to verify (must match the opaque hash)",
      "you@example.com",
    );
    if (!cleartext) return;
  }
  if (!cleartext) {
    setStatus("Email detail missing", "error");
    return;
  }

  if (btn) setButtonLoading(btn, true);
  try {
    await api("/verify-email/request", {
      method: "POST",
      body: JSON.stringify({
        fingerprint: state.currentFingerprint,
        detail: cleartext,
        path,
      }),
    });
    setStatus(`Verification email sent to ${cleartext}`, "success");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

export function renderContext() {
  ctxCurrent.textContent = state.currentIdentity ?? "-";
  ctxServer.textContent = state.server ?? "(not set)";
  if (ctxIdir) {
    ctxIdir.textContent = state.identityDirLabel ?? "-";
  }
  const ctxProtocol = document.getElementById("ctx-protocol");
  if (ctxProtocol) {
    ctxProtocol.textContent = state.protocolVersion ?? "-";
  }
  renderFingerprint();
}

export function renderIdentities() {
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

export async function handleIdentityClick(name) {
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
      state.currentDetails = [];
      renderIdentityDetails();
      await loadAll();
    } catch (err) {
      setStatus(err.message, "error");
    }
  }
}

export function renderContacts() {
  contactsList.innerHTML = "";
  if (!state.contacts.length) {
    contactsList.innerHTML = "<li class='muted'>(no contacts yet)</li>";
    return;
  }
  for (const c of state.contacts) {
    const li = document.createElement("li");
    li.className = "contact-item clickable";
    
    const detailName = getDetailValue(c.details, "name");
    const detailEmail = getDetailValue(c.details, "email");
    const emailMeta = getDetailMeta(c.detailsMeta, "email");
    const emailVerified = emailMeta?.verified === true;
    const emailTagClass = emailVerified ? "email-verified-tag" : "email-unverified-tag";
    const emailTagTitle = emailVerified ? "Email verified" : "Email not verified";
    const isRevoked = !!c.revoked;
    
    const alias = c.localAlias || '';
    const displayEmail = detailEmail || c.localEmail || '';
    const isLocalEmail = !detailEmail && !!c.localEmail;

    li.innerHTML = `
      <div class="contact-info">
        <div class="contact-header">
          <strong>${escapeHtml(c.name)}</strong>
          ${alias ? `<span class="contact-alias">${escapeHtml(alias)}</span>` : ''}
          ${isRevoked ? '<span class="revoked-badge">Revoked</span>' : ''}
          <span class="muted">(${escapeHtml(c.signingKeyType)}/${escapeHtml(c.encryptionKeyType)})</span>
        </div>
        ${detailName || displayEmail ? `
          <div class="contact-details-preview">
            ${detailName ? `<span class="detail-tag">👤 ${escapeHtml(detailName)}</span>` : ''}
            ${displayEmail ? (isLocalEmail
              ? `<span class="detail-tag" title="Local email">✉️ ${escapeHtml(displayEmail)}</span>`
              : `<span class="detail-tag ${emailTagClass}" title="${emailTagTitle}">✉️ ${escapeHtml(displayEmail)}</span>`
            ) : ''}
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

export async function showContactDetails(contact) {
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
      const isOpaque = isOpaqueDetailPath(d.path);
      const resolvedOpaqueValue = isOpaque
        ? contact.resolvedOpaqueDetails?.[d.path] ?? null
        : null;
      const valueHtml = isOpaque
        ? `
          <span class="detail-value" title="${escapeHtml(d.detail)}">${escapeHtml(formatOpaqueHash(d.detail))}</span>
          <span class="muted small">hash</span>
          ${resolvedOpaqueValue
            ? `<span class="detail-tag" title="Resolved opaque value">${escapeHtml(resolvedOpaqueValue)} ✓</span>`
            : `<button class="secondary btn-opaque-check" data-fingerprint="${escapeHtml(contact.fingerprint)}" data-path="${escapeHtml(d.path)}">Check</button>`}
        `
        : isEmail
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
  
  const modal = document.getElementById("contact-detail-modal");
  const nameEl = document.getElementById("contact-detail-name");
  if (contact.localAlias) {
    nameEl.innerHTML = `${escapeHtml(contact.name)} <span class="contact-alias">${escapeHtml(contact.localAlias)}</span>`;
  } else {
    nameEl.textContent = contact.name;
  }
  document.getElementById("contact-detail-fingerprint").textContent = contact.fingerprint;
  document.getElementById("contact-detail-keytypes").textContent = `${contact.signingKeyType} / ${contact.encryptionKeyType}`;
  const revokedBanner = document.getElementById("contact-detail-revoked");
  if (revokedBanner) {
    revokedBanner.style.display = contact.revoked ? "flex" : "none";
  }
  document.getElementById("contact-detail-details").innerHTML = detailsHtml;

  const aliasInput = document.getElementById("contact-local-alias");
  const localEmailInput = document.getElementById("contact-local-email");
  const descInput = document.getElementById("contact-local-description");
  aliasInput.value = contact.localAlias || '';
  localEmailInput.value = contact.localEmail || '';
  descInput.value = contact.localDescription || '';
  const savedIndicator = document.getElementById("contact-local-notes-saved");
  savedIndicator.classList.remove("visible");

  const saveBtn = document.getElementById("contact-local-notes-save-btn");
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
  newSaveBtn.addEventListener("click", async () => {
    setButtonLoading(newSaveBtn, true);
    try {
      await api("/contacts/update-local-notes", {
        method: "POST",
        body: JSON.stringify({
          fingerprint: contact.fingerprint,
          localAlias: aliasInput.value,
          localEmail: localEmailInput.value,
          localDescription: descInput.value,
        }),
      });
      await loadAll();
      savedIndicator.classList.add("visible");
      setTimeout(() => savedIndicator.classList.remove("visible"), 2000);
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setButtonLoading(newSaveBtn, false);
    }
  });

  document.getElementById("contact-detail-sync-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-sync-btn").dataset.name = contact.name;
  document.getElementById("contact-detail-delete-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-delete-btn").dataset.name = contact.name;
  document.getElementById("contact-detail-establish-hierarchy-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-hierarchy-btn").dataset.fingerprint = contact.fingerprint;
  document.getElementById("contact-detail-hierarchy").innerHTML = '<div class="muted small" style="padding:16px">(hierarchy not loaded)</div>';

  const detailContainer = document.getElementById("contact-detail-details");
  detailContainer.querySelectorAll(".btn-opaque-check").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      const targetBtn = e.currentTarget;
      const path = targetBtn.dataset.path;
      const fingerprint = targetBtn.dataset.fingerprint;
      if (!path || !fingerprint) return;
      const candidate = await requestTextInput(`Enter a value to verify for ${path}`, "Value to compare");
      if (!candidate) return;
      setButtonLoading(targetBtn, true);
      try {
        await api("/contacts/resolve-opaque", {
          method: "POST",
          body: JSON.stringify({ fingerprint, path, value: candidate }),
        });
        setStatus(`Opaque detail "${path}" matched and saved locally`, "success");
        await loadAll();
        const refreshed = state.contacts.find((c) => c.fingerprint === contact.fingerprint || c.fingerprint.startsWith(contact.fingerprint));
        if (refreshed) {
          await showContactDetails(refreshed);
        }
      } catch (err) {
        setStatus(err.message, "error");
      } finally {
        setButtonLoading(targetBtn, false);
      }
    });
  });
  
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

export async function deleteLocalContact(name, fingerprint, btn) {
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

export async function syncContact(fingerprint, name, btn) {
  if (btn) setButtonLoading(btn, true);
  try {
    await api("/fetch", {
      method: "POST",
      body: JSON.stringify({ fingerprint, name }),
    });
    setStatus(`Synced contact "${name}" from server`, "success");
    await loadAll();
    document.getElementById("contact-detail-modal").classList.remove("active");
  } catch (err) {
    setStatus(err.message, "error");
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

export function renderServerIdentities() {
  serverIdentitiesList.innerHTML = "";
  const visible = state.serverIdentities.filter((entry) => !entry.revoked);

  if (!visible.length) {
    serverIdentitiesList.innerHTML = "<li class='muted'>(none found)</li>";
  } else {
    for (const entry of visible) {
      const li = document.createElement("li");
      li.className = "server-identity-item";
      const created = entry.createdAt
        ? new Date(entry.createdAt).toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
          })
        : "unknown";
      
      const isAlreadyContact = state.contacts.some(c => c.fingerprint === entry.fingerprint);
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
    
    serverIdentitiesList.querySelectorAll(".btn-import-contact").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const fingerprint = btn.dataset.fingerprint;
        await importServerIdentityAsContact(fingerprint, btn);
      });
    });
  }

  renderServerIdentitiesPagination();
}

export function renderServerIdentitiesPagination() {
  const paginationContainer = document.getElementById("server-identities-pagination");
  const pageInfo = document.getElementById("server-identities-page-info");
  const prevBtn = document.getElementById("server-identities-prev");
  const nextBtn = document.getElementById("server-identities-next");
  
  if (!paginationContainer) return;
  
  const { page, totalPages, total } = state.serverIdentitiesPagination;
  
  if (total === 0) {
    paginationContainer.style.display = "none";
    return;
  }
  
  paginationContainer.style.display = "flex";
  
  if (totalPages <= 1) {
    pageInfo.textContent = `${total} ${total === 1 ? 'identity' : 'identities'}`;
  } else {
    pageInfo.textContent = `Page ${page} of ${totalPages} (${total} total)`;
  }
  
  prevBtn.disabled = page <= 1;
  nextBtn.disabled = page >= totalPages;
}

function formatToastTime(timestamp) {
  const d = new Date(timestamp);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

export function renderToastLogs() {
  if (!settingsLogsList) return;
  settingsLogsList.innerHTML = "";
  if (!Array.isArray(state.toastLogs) || state.toastLogs.length === 0) {
    settingsLogsList.innerHTML = "<li class='muted'>(no logs yet in this session)</li>";
    return;
  }

  for (const entry of state.toastLogs) {
    const li = document.createElement("li");
    const kind = entry.kind || "info";
    const message = entry.message || "";
    const timestamp = Number.isFinite(entry.timestamp) ? entry.timestamp : Date.now();
    li.innerHTML = `
      <span class="settings-log-time">${escapeHtml(formatToastTime(timestamp))}</span>
      <span class="settings-log-kind ${escapeHtml(kind)}">${escapeHtml(kind)}</span>
      <span class="settings-log-message">${escapeHtml(message)}</span>
    `;
    settingsLogsList.appendChild(li);
  }
}

export async function importServerIdentityAsContact(fingerprint, btn) {
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

export async function loadServerIdentities(page = 1, serverOverride = null, searchQuery = "") {
  try {
    const serverUrl = serverOverride || "";
    const queryParams = new URLSearchParams();
    queryParams.set("page", String(page));
    if (serverUrl) queryParams.set("server", serverUrl);
    if (searchQuery) queryParams.set("query", searchQuery);
    
    const res = await api(`/server/identities?${queryParams.toString()}`);
    state.serverIdentities = res.identities ?? [];
    
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

export function updateVerifyResult(elementId, status, verifyStatus) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.className = "result-badge";
  
  if (verifyStatus === "valid") {
    el.classList.add("valid");
    el.textContent = "✓ Valid";
  } else if (verifyStatus === "valid_unbound") {
    el.classList.add("warning");
    el.textContent = "⚠ Valid (legacy unbound)";
  } else if (verifyStatus === "valid_unknown_signer") {
    el.classList.add("warning");
    el.textContent = "⚠ Valid (unknown signer)";
  } else if (verifyStatus === "valid_unknown_signer_unbound") {
    el.classList.add("warning");
    el.textContent = "⚠ Valid unknown signer (legacy unbound)";
  } else if (verifyStatus === "manifest_mismatch") {
    el.classList.add("invalid");
    el.textContent = "✗ Attachment/body mismatch";
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

export function setResultBadge(elementId, kind, text) {
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

export function autoFillSenderContact(detail) {
  const senderInput = document.getElementById("mail-sender-contact");
  if (!senderInput) return;
  senderInput.value = "";
  const payload = detail?.ebpPayload;
  if (!payload || !payload.senderFingerprint) return;
  const fp = payload.senderFingerprint;
  const match = state.contacts.find(
    (c) => c.fingerprint === fp || c.fingerprint?.startsWith(fp.substring(0, 16)),
  );
  if (match) {
    senderInput.value = match.name || match.fingerprint;
  }
}

export function extractEbpPayloadFromText(text) {
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

export function extractEmailAddress(text) {
  const raw = (text || "").trim();
  const angle = raw.match(/<([^>]+)>/);
  const candidate = angle ? angle[1] : raw;
  const match = candidate.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

export function renderMailVerifyMeta(result) {
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
  if (typeof result.serverIdentityMatch === "boolean") {
    lines.push(`Server identity match: ${result.serverIdentityMatch ? "yes" : "no"}`);
  }
  if (Array.isArray(result.recipientFingerprints) && result.recipientFingerprints.length > 0) {
    lines.push(`Recipients: ${result.recipientFingerprints.join(", ")}`);
  }
  metaEl.textContent = lines.join(" • ");
}

let _loadMailAccount = async () => {};
let _loadStoredMailCredentials = async () => {};
let _renderStoredMailCredentials = () => {};

export function setMailLoaders({ loadMailAccount, loadStoredMailCredentials, renderStoredMailCredentials }) {
  _loadMailAccount = loadMailAccount;
  _loadStoredMailCredentials = loadStoredMailCredentials;
  _renderStoredMailCredentials = renderStoredMailCredentials;
}

export async function loadAll() {
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
        state.identityDirLabel = ctx?.identityDirLabel ?? "";
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
    
    if (state.server) {
      await loadServerIdentities(1, null, state.serverIdentitiesSearch);
    } else {
      state.serverIdentities = [];
      state.serverIdentitiesPagination = { page: 1, totalPages: 1, total: 0 };
    }
    
    renderIdentities();
    
    if (state.currentIdentity) {
      await loadPublicIdentityInfo();
    } else {
      state.currentFingerprint = null;
      renderFingerprint();
    }

    const serverUrlInput = document.getElementById("server-url");
    const serverUrlPreset = document.getElementById("server-url-preset");
    if (state.server) {
      if (serverUrlInput) serverUrlInput.value = state.server;
      if (serverUrlPreset) serverUrlPreset.value = state.server;
    } else if (!state.serverDefaultApplied) {
      if (serverUrlInput) serverUrlInput.value = DEFAULT_SERVER_URL;
      if (serverUrlPreset) serverUrlPreset.value = DEFAULT_SERVER_URL;
      state.serverDefaultApplied = true;
    }
    const serverIdentitiesSearchInput = document.getElementById("server-identities-search");
    if (serverIdentitiesSearchInput) {
      serverIdentitiesSearchInput.value = state.serverIdentitiesSearch;
    }

    renderServerIdentities();
    await renderCertificatesPage();
    await _loadMailAccount();
    await _loadStoredMailCredentials();
    _renderStoredMailCredentials();
    renderToastLogs();

    setStatus("Ready", "success");
  } catch (e) {
    const base = e?.message ? String(e.message) : String(e);
    setStatus(`Load failed: ${base} (backend: ${LOCAL_BACKEND_ORIGIN})`, "error");
    console.error("loadAll failed", e);
  }
}
