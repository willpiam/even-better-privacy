const MARKER_START = "-----BEGIN EBP MESSAGE-----";
const MARKER_END = "-----END EBP MESSAGE-----";

const IS_OUTLOOK = /outlook\.(office|live|office365)\.com$/i.test(window.location.host);
const IS_PROTON = /mail\.proton\.me$/i.test(window.location.host) || /mail\.protonmail\.com$/i.test(window.location.host);

const contactCache = {
  loaded: false,
  contacts: []
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

async function loadContacts() {
  if (contactCache.loaded) return contactCache.contacts;
  const response = await sendMessage({ type: "ebp-contacts" });
  contactCache.loaded = true;
  if (!response?.ok) {
    console.warn("EBP contacts load failed:", response?.error);
    contactCache.contacts = [];
    return contactCache.contacts;
  }
  const contacts = response.data?.contacts ?? [];
  contactCache.contacts = contacts;
  return contacts;
}

function formatPayload(payload) {
  return [
    MARKER_START,
    JSON.stringify(payload, null, 2),
    MARKER_END
  ].join("\n");
}

function extractPayload(text) {
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start === -1 || end === -1 || end <= start) return null;
  const jsonText = text.slice(start + MARKER_START.length, end).trim();
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    console.warn("EBP payload JSON parse failed:", error);
    return null;
  }
}

function createButton(label, doc = document) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "ebp-button";
  button.textContent = label;
  return button;
}

function createSelect(doc = document) {
  const select = doc.createElement("select");
  select.className = "ebp-select";
  return select;
}

function showToast(message, isError = false) {
  const toast = document.createElement("div");
  toast.className = isError ? "ebp-toast ebp-toast-error" : "ebp-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("ebp-toast-visible"), 20);
  setTimeout(() => {
    toast.classList.remove("ebp-toast-visible");
    setTimeout(() => toast.remove(), 300);
  }, 2800);
}

function showModal(title, body, status, statusType) {
  const overlay = document.createElement("div");
  overlay.className = "ebp-modal-overlay";

  const modal = document.createElement("div");
  modal.className = "ebp-modal";

  const header = document.createElement("div");
  header.className = "ebp-modal-header";
  header.textContent = title;

  const statusEl = document.createElement("div");
  statusEl.className = "ebp-modal-status";
  if (statusType === "valid") {
    statusEl.className += " ebp-modal-status-valid";
  } else if (statusType === "invalid") {
    statusEl.className += " ebp-modal-status-invalid";
  }
  statusEl.textContent = status;

  const pre = document.createElement("pre");
  pre.className = "ebp-modal-body";
  pre.textContent = body;

  const close = createButton("Close");
  close.className += " ebp-button-secondary";
  close.addEventListener("click", () => overlay.remove());

  modal.appendChild(header);
  modal.appendChild(statusEl);
  modal.appendChild(pre);
  modal.appendChild(close);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function getDetailValue(details, key) {
  if (!details || typeof details !== "object") return "";
  const value = details[key];
  if (Array.isArray(value)) return value[0] ?? "";
  if (typeof value === "string") return value;
  return "";
}

function getContactDisplayName(contact) {
  const details = contact.details ?? {};
  const byName = getDetailValue(details, "name");
  const byEmail = getDetailValue(details, "email");
  return byName || byEmail || contact.name || contact.fingerprint?.slice(0, 8) || "unknown";
}

function resolveRecipientOption(contacts, select) {
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select EBP contact";
  select.appendChild(placeholder);

  contacts.forEach((contact) => {
    const option = document.createElement("option");
    const displayName = getContactDisplayName(contact);
    option.value = contact.name;
    option.textContent = `${displayName} (${contact.fingerprint?.slice(0, 8) ?? "unknown"})`;
    select.appendChild(option);
  });
}

async function buildComposeControls(composeRoot, bodyEl) {
  if (bodyEl.dataset.ebpComposeProcessed === "true") return;
  const existingControls = composeRoot.querySelectorAll("[data-ebp-compose-controls]");
  if (existingControls.length > 0) {
    bodyEl.dataset.ebpComposeProcessed = "true";
    existingControls.forEach((controls, index) => {
      if (index > 0) controls.remove();
    });
    return;
  }
  bodyEl.dataset.ebpComposeProcessed = "true";

  const controls = document.createElement("div");
  controls.className = "ebp-compose-controls";
  controls.dataset.ebpComposeControls = "true";

  const composeDoc = bodyEl.ownerDocument || document;
  const select = createSelect(composeDoc);
  controls.appendChild(select);

  const signEncryptButton = createButton("EBP Sign & Encrypt", composeDoc);
  controls.appendChild(signEncryptButton);

  const refreshButton = createButton("Refresh Contacts", composeDoc);
  refreshButton.className += " ebp-button-secondary";
  controls.appendChild(refreshButton);

  const contacts = await loadContacts();
  resolveRecipientOption(contacts, select);

  refreshButton.addEventListener("click", async () => {
    contactCache.loaded = false;
    const updated = await loadContacts();
    resolveRecipientOption(updated, select);
  });

  signEncryptButton.addEventListener("click", async () => {
    const recipient = select.value;
    if (!recipient) {
      showToast("Select an EBP contact", true);
      return;
    }
    const message = bodyEl.innerText.trim();
    if (!message) {
      showToast("Compose body is empty", true);
      return;
    }
    const password = window.prompt("EBP identity password");
    if (!password) return;
    const response = await sendMessage({
      type: "ebp-encrypt",
      message,
      recipient,
      sign: true,
      password
    });
    if (!response?.ok) {
      showToast(`EBP sign+encrypt failed: ${response?.error ?? "unknown error"}`, true);
      return;
    }
    bodyEl.innerText = formatPayload(response.data);
    showToast("EBP signed+encrypted payload inserted");
  });

  const insertTarget = bodyEl.parentElement || composeRoot;
  if (insertTarget.contains(bodyEl)) {
    insertTarget.insertBefore(controls, bodyEl);
  } else {
    composeRoot.prepend(controls);
  }
}

function findComposeBodies() {
  if (IS_PROTON) {
    const candidates = Array.from(
      document.querySelectorAll(
        '#rooster-editor[contenteditable="true"],[data-testid="composer-editor"][contenteditable="true"],' +
          '[data-testid="composer-body"][contenteditable="true"],div[contenteditable="true"][aria-label="Message body"],' +
          'div[contenteditable="true"][aria-label="Message Body"]'
      )
    );
    return candidates.filter((el) => !el.closest("[data-ebp-compose-controls]"));
  }
  if (IS_OUTLOOK) {
    const candidates = Array.from(
      document.querySelectorAll(
        '[contenteditable="true"][role="textbox"],[contenteditable="true"][aria-label*="Message body"]'
      )
    );
    return candidates.filter((el) => !el.closest("[data-ebp-compose-controls]"));
  }

  return Array.from(document.querySelectorAll('div[aria-label="Message Body"][contenteditable="true"]'));
}

function resolveComposeRoot(bodyEl) {
  if (IS_PROTON) {
    return (
      bodyEl.closest('[data-testid*="composer"]') ||
      bodyEl.closest('[class*="composer"]') ||
      bodyEl.closest('[class*="Composer"]') ||
      bodyEl.closest("section") ||
      bodyEl.parentElement
    );
  }
  if (IS_OUTLOOK) {
    return (
      bodyEl.closest('[data-automationid="ComposeForm"]') ||
      bodyEl.closest('[data-automationid="ContentControl"]') ||
      bodyEl.closest("div[role='dialog']") ||
      bodyEl.parentElement
    );
  }

  return (
    bodyEl.closest("div[role='dialog']") ||
    bodyEl.closest("div.M9") ||
    bodyEl.closest("div.aoP") ||
    bodyEl.parentElement
  );
}

async function initComposeObservers() {
  const bodies = findComposeBodies();
  await Promise.all(
    bodies.map(async (bodyEl) => {
      const root = resolveComposeRoot(bodyEl);
      if (!root) return;
      await buildComposeControls(root, bodyEl);
    })
  );
}

function createDecryptButton(messageBody) {
  if (messageBody.querySelector("[data-ebp-decrypt-button]")) return;
  const button = createButton("Decrypt & Verify", messageBody.ownerDocument);
  button.className += " ebp-decrypt-button";
  button.dataset.ebpDecryptButton = "true";

  button.addEventListener("click", async () => {
    try {
      const text = messageBody.innerText || "";
      const payload = extractPayload(text);
      if (!payload) {
        showToast("No EBP payload found", true);
        return;
      }
      const password = window.prompt("EBP identity password");
      if (!password) return;
      showToast("Decrypting...");
      const response = await sendMessage({
        type: "ebp-decrypt",
        payload,
        password
      });
      if (!response?.ok) {
        showToast(`EBP decrypt failed: ${response?.error ?? "unknown error"}`, true);
        return;
      }
      if (!response.data) {
        showToast("EBP decrypt failed: empty response", true);
        return;
      }
      const { message, verified, verifyStatus, signerFingerprint } = response.data;
      let status = "Unsigned";
      let statusType = "unknown";
      if (verified === true) status = `Verified (${verifyStatus || "valid"})`;
      if (verified === false) status = `Invalid (${verifyStatus || "invalid"})`;
      if (verified === null) status = `Unknown (${verifyStatus || "unknown"})`;
      if (verified === true) statusType = "valid";
      if (verified === false) statusType = "invalid";
      if (signerFingerprint) {
        status = `${status} · signer: ${signerFingerprint}`;
      }
      showModal("EBP Decrypted Message", message ?? "", status, statusType);
    } catch (error) {
      console.error("EBP decrypt handler failed:", error);
      showToast(`EBP decrypt failed: ${error?.message ?? "unknown error"}`, true);
    }
  });

  messageBody.prepend(button);
}

function collectProtonMessageBodies() {
  const selector =
    '[data-testid="message-body"],[data-testid="message-content"],[data-testid="message-view"],' +
    '[data-testid="message-frame"],.message-content,.message-body,.message-view,div[role="document"]';
  const bodies = Array.from(document.querySelectorAll(selector));

  document.querySelectorAll("iframe").forEach((frame) => {
    try {
      const frameDoc = frame.contentDocument;
      if (!frameDoc) return;
      const frameBodies = Array.from(frameDoc.querySelectorAll(selector));
      if (frameBodies.length === 0 && frameDoc.body) {
        frameBodies.push(frameDoc.body);
      }
      bodies.push(...frameBodies);
    } catch (error) {
      // ignore cross-origin frames
    }
  });

  return bodies;
}

function initReadObservers() {
  const messageBodies = IS_PROTON
    ? collectProtonMessageBodies()
    : IS_OUTLOOK
      ? Array.from(
          document.querySelectorAll(
            '[data-automationid="MessageBody"],[data-automationid="readMessageBody"],div[role="document"]'
          )
        )
      : Array.from(document.querySelectorAll("div.a3s"));
  messageBodies.forEach((body) => {
    if (body.dataset.ebpProcessed) return;
    if (body.getAttribute("contenteditable") === "true") return;
    body.dataset.ebpProcessed = "true";
    const text = body.innerText || "";
    if (text.includes(MARKER_START)) {
      createDecryptButton(body);
    }
  });
}

const observer = new MutationObserver(() => {
  initComposeObservers();
  initReadObservers();
});

observer.observe(document.documentElement, { childList: true, subtree: true });

initComposeObservers();
initReadObservers();
