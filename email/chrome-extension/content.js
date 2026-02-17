const MARKER_START = "-----BEGIN EBP MESSAGE-----";
const MARKER_END = "-----END EBP MESSAGE-----";

const IS_OUTLOOK = /outlook\.(office|live|office365)\.com$/i.test(window.location.host);
const IS_PROTON = /mail\.proton\.me$/i.test(window.location.host) || /mail\.protonmail\.com$/i.test(window.location.host);
const IS_GMAIL = /mail\.google\.com$/i.test(window.location.host);

const contactCache = {
  loaded: false,
  contacts: []
};

// Tracks whether any EBP <select> dropdown is currently open so the
// MutationObserver can avoid DOM work that dismisses the native popup
// on macOS Chrome.
let ebpSelectOpen = false;
let pendingObserverRun = false;

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
  if (IS_PROTON) {
    button.style.background = "#1a73e8";
    button.style.color = "#fff";
    button.style.border = "none";
    button.style.borderRadius = "4px";
    button.style.padding = "6px 10px";
    button.style.cursor = "pointer";
    button.style.fontSize = "12px";
  }
  return button;
}

function createSelect(doc = document) {
  const select = doc.createElement("select");
  select.className = "ebp-select";
  if (IS_PROTON) {
    select.style.border = "1px solid #dadce0";
    select.style.borderRadius = "4px";
    select.style.padding = "4px 6px";
    select.style.fontSize = "12px";
    select.style.background = "#fff";
    select.style.color = "#202124";
  }
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

function showModal(title, body, status, statusType, metaLines = []) {
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
  if (metaLines.length) {
    const meta = document.createElement("div");
    meta.className = "ebp-modal-meta";
    metaLines.forEach((line) => {
      const row = document.createElement("div");
      row.className = "ebp-modal-meta-row";
      row.textContent = line;
      meta.appendChild(row);
    });
    modal.appendChild(meta);
  }
  modal.appendChild(pre);
  modal.appendChild(close);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

function requestPassword(promptText = "EBP identity password") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ebp-modal-overlay";

    const modal = document.createElement("div");
    modal.className = "ebp-modal";
    modal.style.maxWidth = "420px";

    const header = document.createElement("div");
    header.className = "ebp-modal-header";
    header.textContent = promptText;

    const input = document.createElement("input");
    input.type = "password";
    input.autocomplete = "current-password";
    input.placeholder = "Password";
    input.style.width = "100%";
    input.style.boxSizing = "border-box";
    input.style.border = "1px solid #dadce0";
    input.style.borderRadius = "6px";
    input.style.padding = "10px 12px";
    input.style.fontSize = "13px";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.justifyContent = "flex-end";

    const cancelButton = createButton("Cancel");
    cancelButton.className += " ebp-button-secondary";
    const submitButton = createButton("Continue");

    function cleanupAndResolve(value) {
      overlay.remove();
      resolve(value);
    }

    cancelButton.addEventListener("click", () => cleanupAndResolve(null));
    submitButton.addEventListener("click", () => {
      const value = input.value;
      if (!value) {
        input.focus();
        return;
      }
      cleanupAndResolve(value);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) cleanupAndResolve(null);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitButton.click();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cleanupAndResolve(null);
      }
    });

    actions.appendChild(cancelButton);
    actions.appendChild(submitButton);
    modal.appendChild(header);
    modal.appendChild(input);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    setTimeout(() => input.focus(), 0);
  });
}

function getDetailValue(details, key) {
  if (!details || typeof details !== "object") return "";
  const value = details[key];
  if (Array.isArray(value)) return value[0] ?? "";
  if (typeof value === "string") return value;
  return "";
}

function getDetailMeta(detailsMeta, key) {
  if (!detailsMeta || typeof detailsMeta !== "object") return null;
  return detailsMeta[key] ?? null;
}

function extractEmail(text) {
  if (!text) return "";
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : "";
}

function collectRecipientEmails(composeRoot) {
  if (!composeRoot) return [];
  const emails = new Set();

  const attrCandidates = composeRoot.querySelectorAll("[email],[data-hovercard-id]");
  attrCandidates.forEach((el) => {
    const candidate =
      el.getAttribute("email") ||
      el.getAttribute("data-hovercard-id") ||
      el.textContent ||
      "";
    const email = extractEmail(candidate);
    if (email) emails.add(email.toLowerCase());
  });

  const mailtoLinks = composeRoot.querySelectorAll('a[href^="mailto:"]');
  mailtoLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const raw = href.replace(/^mailto:/i, "").split("?")[0];
    const email = raw || extractEmail(link.textContent || "");
    if (email) emails.add(email.toLowerCase());
  });

  const inputs = composeRoot.querySelectorAll(
    'input[aria-label*="To"],textarea[aria-label*="To"],input[name="to"],textarea[name="to"]'
  );
  inputs.forEach((input) => {
    const value = input.value || input.getAttribute("value") || "";
    value
      .split(/[;,]/)
      .map((part) => extractEmail(part))
      .filter(Boolean)
      .forEach((email) => emails.add(email.toLowerCase()));
  });

  return Array.from(emails);
}

function findSenderEmail(messageBody) {
  if (!messageBody) return "";
  const root =
    messageBody.closest("div.adn") ||
    messageBody.closest("div[role='listitem']") ||
    messageBody.closest("div[role='article']") ||
    messageBody.closest("div[role='document']") ||
    messageBody.parentElement;
  if (!root) return "";

  const gmailEmailEl = root.querySelector("span[email], span[data-hovercard-id]");
  if (gmailEmailEl) {
    const candidate =
      gmailEmailEl.getAttribute("email") ||
      gmailEmailEl.getAttribute("data-hovercard-id") ||
      gmailEmailEl.textContent ||
      "";
    const email = extractEmail(candidate);
    if (email) return email;
  }

  const mailto = root.querySelector('a[href^="mailto:"]');
  if (mailto) {
    const href = mailto.getAttribute("href") || "";
    const raw = href.replace(/^mailto:/i, "").split("?")[0];
    const email = raw || extractEmail(mailto.textContent || "");
    if (email) return email;
  }

  return extractEmail(root.textContent || "");
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

function createJsonAttachment(data, filename) {
  const jsonText = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonText], { type: "application/json" });
  return new File([blob], filename, { type: "application/json" });
}

function findGmailFileInput(composeRoot) {
  return (
    composeRoot.querySelector('input[type="file"][name="file"]') ||
    composeRoot.querySelector('input[type="file"]') ||
    document.querySelector('input[type="file"][name="file"]') ||
    document.querySelector('input[type="file"]')
  );
}

function attachFilesToInput(fileInput, files) {
  const dataTransfer = new DataTransfer();
  const existing = fileInput.files ? Array.from(fileInput.files) : [];
  existing.forEach((file) => dataTransfer.items.add(file));
  files.forEach((file) => dataTransfer.items.add(file));
  fileInput.files = dataTransfer.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
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
  controls.setAttribute("contenteditable", "false");
  // Isolate EBP controls from compose host handlers without blocking target
  // handlers on EBP buttons/select (do not use capture phase here).
  controls.addEventListener("mousedown", (event) => event.stopPropagation());
  controls.addEventListener("click", (event) => event.stopPropagation());
  if (IS_PROTON) {
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.alignItems = "center";
    controls.style.margin = "8px 0";
    controls.style.padding = "6px";
    controls.style.border = "1px solid #dadce0";
    controls.style.borderRadius = "6px";
    controls.style.background = "#f8f9fa";
    controls.style.fontSize = "12px";
  }

  const composeDoc = bodyEl.ownerDocument || document;
  const select = createSelect(composeDoc);

  // Pause the MutationObserver while the native dropdown is shown so DOM
  // work doesn't collapse it on macOS Chrome.
  function markSelectOpen() {
    ebpSelectOpen = true;
    // Cancel any already-scheduled observer run; it might otherwise execute
    // while the native dropdown is open and dismiss it.
    clearTimeout(observerTimer);
    observerTimer = null;
  }
  select.addEventListener("mousedown", markSelectOpen);
  select.addEventListener("focus", markSelectOpen);
  select.addEventListener("click", (event) => event.stopPropagation());
  select.addEventListener("change", () => { ebpSelectOpen = false; });
  select.addEventListener("blur", () => {
    ebpSelectOpen = false;
    if (pendingObserverRun) {
      pendingObserverRun = false;
      initComposeObservers();
      initReadObservers();
    }
  });

  controls.appendChild(select);

  const recipientStatus = document.createElement("div");
  recipientStatus.className = "ebp-recipient-status";
  recipientStatus.textContent = "Select a recipient to check email details.";
  controls.appendChild(recipientStatus);

  const signEncryptButton = createButton("EBP Sign & Encrypt", composeDoc);
  controls.appendChild(signEncryptButton);

  let signAttachButton = null;
  if (IS_GMAIL) {
    signAttachButton = createButton("EBP Sign (JSON)", composeDoc);
    signAttachButton.className += " ebp-button-secondary";
    controls.appendChild(signAttachButton);
  }

  const refreshButton = createButton("Refresh Contacts", composeDoc);
  refreshButton.className += " ebp-button-secondary";
  if (IS_PROTON) {
    refreshButton.style.background = "#5f6368";
    refreshButton.style.color = "#fff";
  }
  controls.appendChild(refreshButton);

  const contacts = await loadContacts();
  resolveRecipientOption(contacts, select);

  function updateRecipientStatus(contactsList) {
    const recipientName = select.value;
    if (!recipientName) {
      recipientStatus.className = "ebp-recipient-status";
      recipientStatus.textContent = "Select a recipient to check email details.";
      return;
    }

    const contact = contactsList.find((c) => c.name === recipientName);
    if (!contact) {
      recipientStatus.className = "ebp-recipient-status ebp-recipient-status-warn";
      recipientStatus.textContent = "Recipient contact not found in local list.";
      return;
    }

    const email = getDetailValue(contact.details, "email");
    if (!email) {
      recipientStatus.className = "ebp-recipient-status ebp-recipient-status-warn";
      recipientStatus.textContent = "Selected contact has no email detail.";
      return;
    }

    const meta = getDetailMeta(contact.detailsMeta, "email");
    const verified = meta?.verified === true;
    const recipients = collectRecipientEmails(composeRoot);
    const matchesRecipient = recipients.some(
      (value) => value.toLowerCase() === email.toLowerCase()
    );

    const verifiedLabel = verified ? "verified" : "unverified";
    const matchLabel = recipients.length
      ? matchesRecipient
        ? "matches To field ✓"
        : "does not match To field"
      : "no recipient email detected";

    recipientStatus.className = `ebp-recipient-status ${
      verified ? "ebp-recipient-status-ok" : "ebp-recipient-status-warn"
    } ${matchesRecipient ? "ebp-recipient-status-match" : ""}`.trim();
    recipientStatus.textContent = `Contact email: ${email} (${verifiedLabel}) · ${matchLabel}`;
  }

  refreshButton.addEventListener("click", async () => {
    contactCache.loaded = false;
    const updated = await loadContacts();
    resolveRecipientOption(updated, select);
    updateRecipientStatus(updated);
  });

  select.addEventListener("change", () => updateRecipientStatus(contactCache.contacts));
  // Skip events that originate from EBP's own select to avoid DOM work
  // that collapses the native dropdown on macOS Chrome.
  composeRoot.addEventListener("input", (e) => {
    if (e.target && e.target.closest && e.target.closest(".ebp-select")) return;
    updateRecipientStatus(contactCache.contacts);
  }, true);
  composeRoot.addEventListener("change", (e) => {
    if (e.target && e.target.closest && e.target.closest(".ebp-select")) return;
    updateRecipientStatus(contactCache.contacts);
  }, true);
  updateRecipientStatus(contacts);

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
    const password = await requestPassword("EBP identity password");
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

  if (signAttachButton) {
    signAttachButton.addEventListener("click", async () => {
      try {
        const message = bodyEl.innerText.trim();
        if (!message) {
          showToast("Compose body is empty", true);
          return;
        }
        const password = await requestPassword("EBP identity password");
        if (!password) return;
        const response = await sendMessage({
          type: "ebp-sign",
          message,
          password,
          detached: true
        });
        if (!response?.ok) {
          showToast(`EBP sign failed: ${response?.error ?? "unknown error"}`, true);
          return;
        }
        const fileInput = findGmailFileInput(composeRoot);
        if (!fileInput) {
          showToast("Gmail attachment input not found", true);
          return;
        }
        const signatureAttachment = createJsonAttachment(response.data, "ebp-signature.json");
        const identityResponse = await sendMessage({
          type: "ebp-identity-export-public",
          password
        });
        if (!identityResponse?.ok) {
          showToast(`EBP public key export failed: ${identityResponse?.error ?? "unknown error"}`, true);
          return;
        }
        const fingerprint = identityResponse.data?.fingerprint ?? "unknown";
        const publicAttachment = createJsonAttachment(
          identityResponse.data,
          `ebp-pub-${fingerprint}.json`
        );
        attachFilesToInput(fileInput, [signatureAttachment, publicAttachment]);
        showToast("EBP signature + public keys attached");
      } catch (error) {
        console.error("EBP sign attach failed:", error);
        showToast(`EBP sign failed: ${error?.message ?? "unknown error"}`, true);
      }
    });
  }

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
  if (IS_PROTON) {
    button.style.marginBottom = "8px";
    button.style.boxShadow = "0 1px 2px rgba(26, 115, 232, 0.4)";
  }

  button.addEventListener("click", async () => {
    try {
      const text = messageBody.innerText || "";
      const payload = extractPayload(text);
      if (!payload) {
        showToast("No EBP payload found", true);
        return;
      }
      const password = await requestPassword("EBP identity password");
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

      const metaLines = [];
      if (verified === true && signerFingerprint) {
        const contacts = await loadContacts();
        const signer = contacts.find((contact) => contact.fingerprint === signerFingerprint);
        const signerMeta = signer ? getDetailMeta(signer.detailsMeta, "email") : null;
        const signerEmail = signer && signerMeta?.verified
          ? getDetailValue(signer.details, "email")
          : "";
        if (signerEmail) {
          const senderEmail = findSenderEmail(messageBody);
          const sameSender =
            senderEmail &&
            senderEmail.toLowerCase() === signerEmail.toLowerCase();
          const matchLabel = sameSender ? " ✓ matches sender" : "";
          metaLines.push(`Verified signer email: ${signerEmail}${matchLabel}`);
        }
      }

      showModal("EBP Decrypted Message", message ?? "", status, statusType, metaLines);
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
    } catch (_error) {
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

let observerTimer = null;
const observer = new MutationObserver(() => {
  // While a native <select> dropdown is open, skip all DOM work so macOS
  // Chrome doesn't collapse the popup.
  if (ebpSelectOpen) {
    pendingObserverRun = true;
    return;
  }
  // Debounce: Gmail fires many rapid mutations; batch them into one pass.
  clearTimeout(observerTimer);
  observerTimer = setTimeout(() => {
    // The dropdown may have opened after this timer was queued.
    if (ebpSelectOpen) {
      pendingObserverRun = true;
      return;
    }
    initComposeObservers();
    initReadObservers();
  }, 200);
});

observer.observe(document.documentElement, { childList: true, subtree: true });

initComposeObservers();
initReadObservers();
