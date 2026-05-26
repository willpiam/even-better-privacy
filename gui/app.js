import {
  loadUiPreferences,
  PASSWORD_POLICY_ENFORCE_PREF_KEY,
  saveBooleanPreference,
  state,
} from "./js/state.js";
import {
  api,
  escapeHtml,
  onStatusChange,
  setButtonLoading,
  setStatus,
  withLoading,
} from "./js/ui.js";
import { requestPassword, showConfirmModal } from "./js/modals.js";
import {
  buildFileSignMessage,
  downloadJsonFromTextarea,
  generateRandomSaltHex,
  hashFileSha256Hex,
  hashTextSha256Hex,
  loadJsonFileIntoTextarea,
  readFileAsBase64,
  safeDownloadFileName,
} from "./js/crypto-utils.js";
import { initContactSearch } from "./js/contact-search.js";
import {
  loadContactHierarchyDiagram,
  loadHierarchyTree,
  navigateToHierarchyWithContact,
  renderCertificatesPage,
  resolveCertificateFingerprint,
} from "./js/hierarchy.js";
import {
  deleteLocalContact,
  loadAll,
  loadPublicIdentityInfo,
  loadServerIdentities,
  renderIdentityDetails,
  renderServerIdentities,
  renderToastLogs,
  setMailLoaders,
  setResultBadge,
  syncContact,
  updateVerifyResult,
} from "./js/render.js";
import {
  ensureMailPageUnlocked,
  initMailPage,
  loadMailAccount,
  loadMailMessages,
  loadStoredMailCredentials,
  renderStoredMailCredentials,
} from "./js/mail.js";
import { updateRevokeDetailPathOptions } from "./js/revocation.js";

// Wire late-bound mail loaders into render.js to break the circular dependency
setMailLoaders({
  loadMailAccount,
  loadStoredMailCredentials,
  renderStoredMailCredentials,
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

const navItems = document.querySelectorAll(".nav-item[data-page]");
const pages = document.querySelectorAll(".page");

function navigateTo(pageId) {
  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageId);
  });

  pages.forEach((page) => {
    page.classList.toggle("active", page.id === `page-${pageId}`);
  });

  window.location.hash = pageId;

  if (pageId === "mail") {
    void ensureMailPageUnlocked().then((unlocked) => {
      if (unlocked && state.mailMessages.length === 0) {
        loadMailMessages(1).catch((err) => {
          setStatus(err.message, "error");
        });
      }
    });
  }
  if (pageId === "certificates") {
    void renderCertificatesPage();
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    navigateTo(item.dataset.page);
  });
});

function initNavigation() {
  const hash = window.location.hash.slice(1);
  const validPages = Array.from(navItems).map((item) => item.dataset.page);
  if (hash && validPages.includes(hash)) {
    navigateTo(hash);
  } else {
    navigateTo("identities");
  }
}

async function requestSignConfirmation(message) {
  const preview = message.length > 240
    ? `${message.slice(0, 240)}...`
    : message;
  const approved = await showConfirmModal(
    "Confirm Signing Request",
    `You are signing this content:\n\n${preview}`,
    "Sign",
  );
  if (!approved) return null;
  return {
    approved: true,
    approvedAt: Date.now(),
    messageHash: await hashTextSha256Hex(message),
  };
}

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.slice(1);
  const validPages = Array.from(navItems).map((item) => item.dataset.page);
  if (hash && validPages.includes(hash)) {
    navigateTo(hash);
  }
});

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

// ─────────────────────────────────────────────────────────────────────────────
// Contact modal action wiring
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById("contact-detail-sync-btn").addEventListener(
  "click",
  async (e) => {
    const btn = e.target;
    const fingerprint = btn.dataset.fingerprint;
    const name = btn.dataset.name;
    await syncContact(fingerprint, name, btn);
  },
);

document.getElementById("contact-detail-delete-btn").addEventListener(
  "click",
  async (e) => {
    const btn = e.target;
    const name = btn.dataset.name;
    const fingerprint = btn.dataset.fingerprint;
    await deleteLocalContact(name, fingerprint, btn);
  },
);

document.getElementById("contact-detail-establish-hierarchy-btn")
  .addEventListener("click", (e) => {
    const btn = e.target;
    const fingerprint = btn.dataset.fingerprint;
    if (!fingerprint) {
      setStatus("Contact fingerprint missing", "error");
      return;
    }
    navigateToHierarchyWithContact(fingerprint, navigateTo);
    document.getElementById("contact-detail-modal").classList.remove("active");
  });

document.getElementById("contact-detail-hierarchy-btn").addEventListener(
  "click",
  async (e) => {
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
  },
);

document.getElementById("hierarchy-tree-load-btn").addEventListener(
  "click",
  async (e) => {
    const btn = e.target;
    setButtonLoading(btn, true);
    try {
      await loadHierarchyTree();
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      setButtonLoading(btn, false);
    }
  },
);

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

document.getElementById("copy-fingerprint-btn").addEventListener(
  "click",
  async (e) => {
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
  },
);

const clearLogsBtn = document.getElementById("settings-logs-clear");
if (clearLogsBtn) {
  clearLogsBtn.addEventListener("click", () => {
    state.toastLogs = [];
    renderToastLogs();
    setStatus("Logs cleared", "success", { log: false });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download / file-input buttons
// ─────────────────────────────────────────────────────────────────────────────

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
    await downloadJsonFromTextarea(
      "enc-file-output",
      "ebp-encrypted-file.json",
    );
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
    state.decryptedFileResult = null;
  });
}

const verifyFilePayloadFile = document.getElementById(
  "verify-file-payload-file",
);
if (verifyFilePayloadFile) {
  verifyFilePayloadFile.addEventListener("change", async () => {
    await loadJsonFileIntoTextarea(
      verifyFilePayloadFile,
      "verify-file-payload",
    );
    updateVerifyResult("verify-file-result", null, null);
    const details = document.getElementById("verify-file-details");
    const signedMessage = document.getElementById("verify-file-signed-message");
    if (details) details.value = "";
    if (signedMessage) signedMessage.value = "";
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Server identity search (debounced)
// ─────────────────────────────────────────────────────────────────────────────

const serverIdentitySearchInput = document.getElementById(
  "server-identities-search",
);
let serverIdentitySearchTimeout = null;

if (serverIdentitySearchInput) {
  serverIdentitySearchInput.addEventListener("input", () => {
    state.serverIdentitiesSearch = serverIdentitySearchInput.value.trim();
    if (serverIdentitySearchTimeout) {
      clearTimeout(serverIdentitySearchTimeout);
    }
    serverIdentitySearchTimeout = setTimeout(async () => {
      const serverOverride =
        document.getElementById("server-identities-override")?.value.trim() ||
        "";
      setStatus("Loading...");
      await loadServerIdentities(
        1,
        serverOverride || null,
        state.serverIdentitiesSearch,
      );
      renderServerIdentities();
      setStatus("Ready", "success");
    }, 250);
  });
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
      await api("/server", {
        method: "POST",
        body: JSON.stringify({ clear: true }),
      });
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

document.getElementById("generate-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const name = document.getElementById("gen-name").value.trim();
    const signingType = document.getElementById("gen-signing").value;
    const force = document.getElementById("gen-force").checked;
    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter a password to secure this identity",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        await api("/identity/generate", {
          method: "POST",
          body: JSON.stringify({
            name,
            signingType,
            encryptionType: "kyber",
            password,
            force,
            enforcePasswordPolicy: state.enforcePasswordPolicy,
          }),
        });
        setStatus("Identity generated", "success");
        document.getElementById("gen-name").value = "";
        document.getElementById("gen-force").checked = false;
        await loadAll();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

const hdGenerateMnemonic = document.getElementById("hd-generate-mnemonic");
if (hdGenerateMnemonic) {
  hdGenerateMnemonic.addEventListener("click", async () => {
    await withLoading(hdGenerateMnemonic, async () => {
      try {
        const res = await api("/hd/mnemonic", {
          method: "POST",
          body: JSON.stringify({ strength: 256 }),
        });
        document.getElementById("hd-mnemonic").value = res.mnemonic;
        document.getElementById("hd-confirm-mnemonic").value = "";
        setStatus(
          "HD mnemonic generated with BIP39 English words. This is an ebp-hd-v1 mnemonic, not a Bitcoin wallet seed.",
          "success",
        );
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  });
}

const hdForm = document.getElementById("hd-form");
if (hdForm) {
  hdForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const mnemonic = document.getElementById("hd-mnemonic").value.trim();
    const confirmMnemonic = document.getElementById("hd-confirm-mnemonic").value
      .trim();
    if (mnemonic !== confirmMnemonic) {
      setStatus("Mnemonic confirmation does not match", "error");
      return;
    }
    const name = document.getElementById("hd-name").value.trim();
    const indexValue = document.getElementById("hd-index").value.trim();
    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter a password to secure this HD identity",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        const body = {
          name,
          mnemonic,
          passphrase: document.getElementById("hd-passphrase").value,
          password,
          profile: document.getElementById("hd-profile").value,
          account: Number(document.getElementById("hd-account").value || "0"),
          change: document.getElementById("hd-change").value,
          force: document.getElementById("hd-force").checked,
          enforcePasswordPolicy: state.enforcePasswordPolicy,
        };
        if (indexValue) body.index = Number(indexValue);
        const res = await api("/hd/identity", {
          method: "POST",
          body: JSON.stringify(body),
        });
        setStatus(
          `HD identity derived at ${res.identity.hdProvenance.path}`,
          "success",
        );
        document.getElementById("hd-name").value = "";
        document.getElementById("hd-index").value = "";
        document.getElementById("hd-force").checked = false;
        await loadAll();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  });
}

document.getElementById("export-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword(
        "Enter password to export your public identity",
      );
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      const res = await api("/identity/export-public", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      document.getElementById("export-output").value = JSON.stringify(
        res,
        null,
        2,
      );
      setStatus("Exported", "success");
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
      await api("/contacts/import", {
        method: "POST",
        body: JSON.stringify({ contact, name }),
      });
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
        body: JSON.stringify({
          fingerprint,
          name: name || undefined,
          server: server || undefined,
        }),
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
  const includeIdentity =
    document.getElementById("sign-include-identity").checked;
  await withLoading(btn, async () => {
    try {
      const password = await requestPassword(
        "Enter password to sign this message",
      );
      if (!password) {
        setStatus("Password is required", "error");
        return;
      }
      const signConfirmation = await requestSignConfirmation(message);
      if (!signConfirmation) {
        setStatus("Signing cancelled", "error");
        return;
      }
      const res = await api("/sign", {
        method: "POST",
        body: JSON.stringify({
          message,
          password,
          detached,
          includeIdentity,
          includeSalt,
          signConfirmation,
        }),
      });
      document.getElementById("sign-output").value = JSON.stringify(
        res,
        null,
        2,
      );
      setStatus("Signed", "success");
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
  const usePublicKeys =
    document.getElementById("verify-use-public-keys").checked;
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
          publicIdentity,
        }),
      });
      updateVerifyResult(
        "verify-result",
        res.verified,
        res.verified ? "valid" : "invalid",
      );
      setStatus("Verified", "success");
    } catch (err) {
      setStatus(err.message, "error");
      updateVerifyResult("verify-result", null, null);
    }
  });
});

document.getElementById("sign-file-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const fileInput = document.getElementById("sign-file-input");
    const includeSalt =
      document.getElementById("sign-file-include-salt").checked;
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

        const password = await requestPassword(
          "Enter password to sign this file hash",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        const signConfirmation = await requestSignConfirmation(message);
        if (!signConfirmation) {
          setStatus("Signing cancelled", "error");
          return;
        }

        const signRes = await api("/sign", {
          method: "POST",
          body: JSON.stringify({
            message,
            password,
            signConfirmation,
            detached: true,
            includeIdentity: true,
            includeSalt: false,
          }),
        });

        if (!signRes?.signature || !signRes?.identity) {
          throw new Error(
            "Signing response missing signature or public identity",
          );
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
  },
);

document.getElementById("verify-file-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const fileInput = document.getElementById("verify-file-input");
    const payloadRaw = document.getElementById("verify-file-payload").value;
    const detailsOutput = document.getElementById("verify-file-details");
    const signedMessageOutput = document.getElementById(
      "verify-file-signed-message",
    );
    const file = fileInput?.files?.[0];

    await withLoading(btn, async () => {
      try {
        if (!file) throw new Error("Please select the file to verify");
        if (!payloadRaw.trim()) throw new Error("Signature JSON is required");

        const payload = JSON.parse(payloadRaw);
        if (!payload || typeof payload !== "object") {
          throw new Error("Signature payload must be a JSON object");
        }
        if (payload.type !== "ebp-signed-file") {
          throw new Error('Signature payload type must be "ebp-signed-file"');
        }

        const expectedHash = typeof payload.fileHash === "string"
          ? payload.fileHash
          : "";
        if (!expectedHash) {
          throw new Error("Signature payload missing fileHash");
        }
        const signature = typeof payload.signature === "string"
          ? payload.signature
          : "";
        if (!signature) throw new Error("Signature payload missing signature");
        const identity = payload.identity;
        if (!identity || typeof identity !== "object") {
          throw new Error("Signature payload missing identity public keys");
        }

        const computedHash = await hashFileSha256Hex(file);
        const salt = typeof payload.salt === "string" ? payload.salt : "";
        const contextMessage = typeof payload.contextMessage === "string"
          ? payload.contextMessage
          : "";
        const reconstructedMessage = buildFileSignMessage(
          computedHash,
          salt,
          contextMessage,
        );

        if (detailsOutput) detailsOutput.value = "";
        if (signedMessageOutput) signedMessageOutput.value = "";

        if (computedHash !== expectedHash) {
          setResultBadge("verify-file-result", "invalid", "✗ Invalid");
          if (detailsOutput) {
            detailsOutput.value = [
              "File hash mismatch.",
              `Expected (from signature): ${expectedHash}`,
              `Computed (uploaded file): ${computedHash}`,
              "Verification stopped before key and signature checks.",
            ].join("\n");
          }
          setStatus("File hash mismatch", "error");
          return;
        }

        const computedFingerprintRes = await api(
          "/identity/fingerprint-from-public",
          {
            method: "POST",
            body: JSON.stringify({ publicIdentity: identity }),
          },
        );
        const computedFingerprint =
          typeof computedFingerprintRes?.fingerprint === "string"
            ? computedFingerprintRes.fingerprint
            : "";
        const payloadFingerprint = typeof payload.fingerprint === "string"
          ? payload.fingerprint
          : "";
        const identityFingerprint = typeof identity.fingerprint === "string"
          ? identity.fingerprint
          : "";

        if (
          payloadFingerprint && identityFingerprint &&
          payloadFingerprint !== identityFingerprint
        ) {
          setResultBadge("verify-file-result", "invalid", "✗ Invalid");
          if (detailsOutput) {
            detailsOutput.value = [
              "Fingerprint mismatch inside signature JSON.",
              `payload.fingerprint: ${payloadFingerprint}`,
              `identity.fingerprint: ${identityFingerprint}`,
              "Verification stopped before signature check.",
            ].join("\n");
          }
          setStatus("Fingerprint mismatch in signature JSON", "error");
          return;
        }

        const expectedFingerprint = payloadFingerprint || identityFingerprint;
        if (!expectedFingerprint) {
          setResultBadge("verify-file-result", "invalid", "✗ Invalid");
          if (detailsOutput) {
            detailsOutput.value =
              "Fingerprint missing from signature JSON (expected on payload or identity object).";
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
              "Verification stopped before signature check.",
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
              "File hash and fingerprint checks passed, but the signature is not valid for the reconstructed message.",
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
            `Signer fingerprint: ${expectedFingerprint}`,
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
  },
);

const verifyPublicKeysToggle = document.getElementById(
  "verify-use-public-keys",
);
if (verifyPublicKeysToggle) {
  verifyPublicKeysToggle.addEventListener("change", (e) => {
    const wrapper = document.getElementById("verify-public-keys-wrapper");
    if (!wrapper) return;
    wrapper.style.display = e.target.checked ? "block" : "none";
  });
}

function resolveRecipientBinding(recipient) {
  const query = recipient.trim().toLowerCase();
  if (!query) return null;
  const contact = state.contacts.find((c) => {
    const names = [
      c.name,
      c.fingerprint,
      c.localAlias,
      c.localEmail,
    ].filter(Boolean).map((v) => String(v).toLowerCase());
    return names.includes(query);
  });
  if (contact) {
    return {
      label: contact.name || contact.localAlias || "contact",
      fingerprint: contact.fingerprint,
    };
  }
  return { label: "direct fingerprint", fingerprint: recipient.trim() };
}

function updateRecipientBindingPreview(inputId, outputId, signId) {
  const output = document.getElementById(outputId);
  if (!output) return;
  const signed = document.getElementById(signId)?.checked;
  const recipient = document.getElementById(inputId)?.value?.trim() || "";
  if (!signed || !recipient) {
    output.textContent = "";
    return;
  }
  const binding = resolveRecipientBinding(recipient);
  output.textContent = binding
    ? `Signed payload will bind recipient ${binding.label}: ${binding.fingerprint}`
    : "";
}

for (
  const [inputId, outputId, signId] of [
    ["enc-recipient", "enc-recipient-binding", "enc-sign"],
    ["enc-file-recipient", "enc-file-recipient-binding", "enc-file-sign"],
  ]
) {
  document.getElementById(inputId)?.addEventListener(
    "input",
    () => updateRecipientBindingPreview(inputId, outputId, signId),
  );
  document.getElementById(signId)?.addEventListener(
    "change",
    () => updateRecipientBindingPreview(inputId, outputId, signId),
  );
}

document.getElementById("encrypt-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const message = document.getElementById("enc-message").value;
    const recipient = document.getElementById("enc-recipient").value.trim();
    const sign = document.getElementById("enc-sign").checked;
    updateRecipientBindingPreview(
      "enc-recipient",
      "enc-recipient-binding",
      "enc-sign",
    );
    await withLoading(btn, async () => {
      try {
        const body = { message, recipient, sign };
        if (sign) {
          const password = await requestPassword(
            "Enter password to sign this message",
          );
          if (!password) {
            setStatus("Password is required to sign", "error");
            return;
          }
          body.password = password;
        }
        const res = await api("/encrypt", {
          method: "POST",
          body: JSON.stringify(body),
        });
        document.getElementById("enc-output").value = JSON.stringify(
          res,
          null,
          2,
        );
        setStatus("Encrypted", "success");
        if (sign) {
          await loadPublicIdentityInfo();
        }
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("decrypt-form").addEventListener(
  "submit",
  async (e) => {
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
          body: JSON.stringify({
            payload,
            password,
            sender: sender || undefined,
          }),
        });
        document.getElementById("dec-output").value = res.message ?? "";
        updateVerifyResult("dec-verified", res.verified, res.verifyStatus);
        setStatus("Decrypted", "success");
      } catch (err) {
        setStatus(err.message, "error");
        updateVerifyResult("dec-verified", null, null);
      }
    });
  },
);

document.getElementById("encrypt-file-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const fileInput = document.getElementById("enc-file-input");
    const recipient = document.getElementById("enc-file-recipient").value
      .trim();
    const sign = document.getElementById("enc-file-sign").checked;
    const file = fileInput?.files?.[0];
    updateRecipientBindingPreview(
      "enc-file-recipient",
      "enc-file-recipient-binding",
      "enc-file-sign",
    );
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
          const password = await requestPassword(
            "Enter password to sign encrypted file payload",
          );
          if (!password) {
            setStatus("Password is required to sign", "error");
            return;
          }
          body.password = password;
        }
        const res = await api("/encrypt-file", {
          method: "POST",
          body: JSON.stringify(body),
        });
        document.getElementById("enc-file-output").value = JSON.stringify(
          res,
          null,
          2,
        );
        setStatus("File encrypted", "success");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("decrypt-file-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const payloadRaw = document.getElementById("dec-file-payload").value;
    const sender = document.getElementById("dec-file-sender").value.trim();
    const info = document.getElementById("dec-file-info");
    const downloadBtn = document.getElementById("dec-file-download-btn");
    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to decrypt file payload",
        );
        if (!password) {
          setStatus("Password is required", "error");
          updateVerifyResult("dec-file-verified", null, null);
          return;
        }
        const payload = JSON.parse(payloadRaw);
        const res = await api("/decrypt-file", {
          method: "POST",
          body: JSON.stringify({
            payload,
            password,
            sender: sender || undefined,
          }),
        });
        state.decryptedFileResult = res;
        if (downloadBtn) downloadBtn.disabled = false;
        if (info) {
          info.value = `${res.fileName || "decrypted.bin"} (${
            res.fileSize || 0
          } bytes, ${res.mimeType || "application/octet-stream"})`;
        }
        updateVerifyResult("dec-file-verified", res.verified, res.verifyStatus);
        setStatus("File decrypted payload ready for download", "success");
      } catch (err) {
        state.decryptedFileResult = null;
        if (downloadBtn) downloadBtn.disabled = true;
        if (info) info.value = "";
        updateVerifyResult("dec-file-verified", null, null);
        setStatus(err.message, "error");
      }
    });
  },
);

const decFileDownloadBtn = document.getElementById("dec-file-download-btn");
if (decFileDownloadBtn) {
  decFileDownloadBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!state.decryptedFileResult?.fileDataBase64) {
      setStatus("No decrypted file available to download", "error");
      return;
    }
    try {
      const filename = safeDownloadFileName(state.decryptedFileResult.fileName);
      const res = await api("/save-file", {
        method: "POST",
        body: JSON.stringify({
          base64Content: state.decryptedFileResult.fileDataBase64,
          filename,
        }),
      });
      setStatus(`Saved to ${res.path}`, "success");
    } catch (err) {
      setStatus(err.message || "Failed to save file", "error");
    }
  });
}

document.getElementById("publish-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const server = document.getElementById("publish-server").value.trim();
    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to publish your identity",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        await api("/publish", {
          method: "POST",
          body: JSON.stringify({ password, server: server || undefined }),
        });
        setStatus("Published", "success");
        await loadAll();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("add-detail-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const path = document.getElementById("detail-path").value.trim();
    const detail = document.getElementById("detail-value").value.trim();
    const push = document.getElementById("detail-push").checked;
    const opaque = document.getElementById("detail-opaque").checked;
    const effectivePath = opaque && !path.startsWith("opaque::")
      ? `opaque::${path}`
      : path;

    if (!path || !detail) {
      setStatus("Path and value are required", "error");
      return;
    }

    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to add this detail",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        await api("/detail", {
          method: "POST",
          body: JSON.stringify({ path: effectivePath, detail, password, push }),
        });
        setStatus(
          `Detail "${effectivePath}" added${
            push ? " and pushed to server" : ""
          }`,
          "success",
        );
        document.getElementById("detail-path").value = "";
        document.getElementById("detail-value").value = "";
        document.getElementById("detail-opaque").checked = false;
        await loadPublicIdentityInfo();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("certificate-propose-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const role = document.getElementById("certificate-role-master").checked
      ? "master"
      : "child";
    const otherInput = document.getElementById("certificate-other-fingerprint")
      .value.trim();
    const otherFingerprint = resolveCertificateFingerprint(otherInput);
    const context = document.getElementById("certificate-context").value.trim();
    const expiryRaw = document.getElementById("certificate-expiry").value;
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
        const password = await requestPassword(
          "Enter password to create and sign hierarchy certificate",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }

        const masterFingerprint = role === "master"
          ? state.currentFingerprint
          : otherFingerprint;
        const childFingerprint = role === "master"
          ? otherFingerprint
          : state.currentFingerprint;
        await api("/hierarchy/propose", {
          method: "POST",
          body: JSON.stringify({
            masterFingerprint,
            childFingerprint,
            context,
            expiry,
            password,
          }),
        });
        setStatus(
          "Certificate proposed and awaiting other party acceptance",
          "success",
        );
        document.getElementById("certificate-context").value = "";
        document.getElementById("certificate-expiry").value = "";
        await renderCertificatesPage();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("server-identities-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const serverOverride = document.getElementById("server-identities-override")
      .value.trim();
    await withLoading(btn, async () => {
      try {
        await loadServerIdentities(
          1,
          serverOverride || null,
          state.serverIdentitiesSearch,
        );
        renderServerIdentities();
        setStatus("Server identities refreshed", "success");
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("server-identities-prev").addEventListener(
  "click",
  async () => {
    const { page } = state.serverIdentitiesPagination;
    if (page <= 1) return;
    const serverOverride = document.getElementById("server-identities-override")
      .value.trim();
    setStatus("Loading...");
    await loadServerIdentities(
      page - 1,
      serverOverride || null,
      state.serverIdentitiesSearch,
    );
    renderServerIdentities();
    setStatus("Ready", "success");
  },
);

document.getElementById("server-identities-next").addEventListener(
  "click",
  async () => {
    const { page, totalPages } = state.serverIdentitiesPagination;
    if (page >= totalPages) return;
    const serverOverride = document.getElementById("server-identities-override")
      .value.trim();
    setStatus("Loading...");
    await loadServerIdentities(
      page + 1,
      serverOverride || null,
      state.serverIdentitiesSearch,
    );
    renderServerIdentities();
    setStatus("Ready", "success");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Revocation form handlers
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById("revoke-detail-form").addEventListener(
  "submit",
  async (e) => {
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
      "Revoke",
    );

    if (!confirmed) return;

    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to revoke this detail",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        await api("/revoke/detail", {
          method: "POST",
          body: JSON.stringify({
            path,
            reason: reason || undefined,
            password,
            push,
          }),
        });
        setStatus(
          `Detail "${path}" revoked${push ? " and pushed to server" : ""}`,
          "success",
        );
        document.getElementById("revoke-detail-path").value = "";
        document.getElementById("revoke-detail-reason").value = "";
        await loadPublicIdentityInfo();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("emergency-cert-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');

    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to generate the emergency certificate",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        const res = await api("/revoke/emergency-cert", {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        document.getElementById("emergency-cert-output").value = JSON.stringify(
          res,
          null,
          2,
        );
        setStatus(
          "Emergency certificate generated - store it securely!",
          "success",
        );
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

document.getElementById("revoke-identity-form").addEventListener(
  "submit",
  async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const reason = document.getElementById("revoke-identity-reason").value
      .trim();
    const push = document.getElementById("revoke-identity-push").checked;

    const confirmed = await showConfirmModal(
      "⚠️ Revoke Identity",
      "This will permanently mark your identity as compromised. This action is IRREVERSIBLE. Are you absolutely sure?",
      "Yes, Revoke My Identity",
    );

    if (!confirmed) return;

    const doubleConfirmed = await showConfirmModal(
      "Final Confirmation",
      "You are about to revoke your identity. Type 'REVOKE' in your mind and click confirm if you're certain.",
      "I Understand, Revoke",
    );

    if (!doubleConfirmed) return;

    await withLoading(btn, async () => {
      try {
        const password = await requestPassword(
          "Enter password to revoke your identity",
        );
        if (!password) {
          setStatus("Password is required", "error");
          return;
        }
        await api("/revoke/identity", {
          method: "POST",
          body: JSON.stringify({ reason: reason || undefined, password, push }),
        });
        setStatus(
          `Identity revoked${push ? " and pushed to server" : ""}`,
          "success",
        );
        document.getElementById("revoke-identity-reason").value = "";
        await loadPublicIdentityInfo();
      } catch (err) {
        setStatus(err.message, "error");
      }
    });
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Initialize
// ─────────────────────────────────────────────────────────────────────────────

loadUiPreferences();

const enforcePasswordPolicyToggle = document.getElementById(
  "settings-enforce-password-policy",
);
if (enforcePasswordPolicyToggle) {
  enforcePasswordPolicyToggle.checked = Boolean(state.enforcePasswordPolicy);
  enforcePasswordPolicyToggle.addEventListener("change", () => {
    state.enforcePasswordPolicy = enforcePasswordPolicyToggle.checked;
    saveBooleanPreference(
      PASSWORD_POLICY_ENFORCE_PREF_KEY,
      state.enforcePasswordPolicy,
    );
  });
}

onStatusChange(() => renderToastLogs());
initNavigation();
initCollapsibleSections();
initContactSearch();
initMailPage();
renderToastLogs();
loadAll();
