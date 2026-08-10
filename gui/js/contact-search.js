import { state, getDetailValue } from "./state.js";
import { escapeHtml } from "./ui.js";
import { shortFingerprint } from "./fingerprint.js";

const contactSearchFields = [
  { inputId: "enc-recipient", dropdownId: "enc-recipient-dropdown" },
  { inputId: "verify-sender", dropdownId: "verify-sender-dropdown" },
  { inputId: "dec-sender", dropdownId: "dec-sender-dropdown" },
  { inputId: "enc-file-recipient", dropdownId: "enc-file-recipient-dropdown" },
  { inputId: "dec-file-sender", dropdownId: "dec-file-sender-dropdown" },
  { inputId: "certificate-other-fingerprint", dropdownId: "certificate-other-fingerprint-dropdown" },
];

let activeDropdown = null;
let highlightedIndex = -1;

export function initContactSearch() {
  for (const field of contactSearchFields) {
    const input = document.getElementById(field.inputId);
    const dropdown = document.getElementById(field.dropdownId);
    if (!input || !dropdown) continue;

    input.addEventListener("input", () => {
      filterContacts(input, dropdown);
    });

    input.addEventListener("focus", () => {
      filterContacts(input, dropdown);
    });

    input.addEventListener("keydown", (e) => {
      handleSearchKeydown(e, input, dropdown);
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".contact-search-wrapper")) {
        closeAllDropdowns();
      }
    });
  }

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
  
  if (!state.contacts.length) {
    dropdown.innerHTML = '<div class="contact-search-no-results">No contacts available</div>';
    dropdown.classList.add("active");
    activeDropdown = dropdown;
    highlightedIndex = -1;
    return;
  }

  const filtered = state.contacts.filter((c) => {
    const name = (c.name || "").toLowerCase();
    const fingerprint = (c.fingerprint || "").toLowerCase();
    const email = (getDetailValue(c.details, "email") || "").toLowerCase();
    const detailName = (getDetailValue(c.details, "name") || "").toLowerCase();
    const alias = (c.localAlias || "").toLowerCase();
    const localEmail = (c.localEmail || "").toLowerCase();
    
    if (!query) return true;
    
    return (
      name.includes(query) ||
      fingerprint.includes(query) ||
      email.includes(query) ||
      detailName.includes(query) ||
      alias.includes(query) ||
      localEmail.includes(query)
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
    const alias = c.localAlias || '';
    const dropdownEmail = email || c.localEmail || '';
    const shortFp = shortFingerprint(c.fingerprint);

    item.innerHTML = `
      <div class="contact-search-item-name">
        ${highlightMatch(escapeHtml(c.name), query)}
        ${alias ? `<span class="contact-alias" style="margin-left:6px">${highlightMatch(escapeHtml(alias), query)}</span>` : ""}
      </div>
      ${detailName || dropdownEmail ? `
        <div class="contact-search-item-details">
          ${detailName ? `<span class="contact-search-item-detail">👤 ${highlightMatch(escapeHtml(detailName), query)}</span>` : ""}
          ${dropdownEmail ? `<span class="contact-search-item-detail">✉️ ${highlightMatch(escapeHtml(dropdownEmail), query)}</span>` : ""}
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
  if (input.id === "certificate-other-fingerprint") {
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

export function closeAllDropdowns() {
  document.querySelectorAll(".contact-search-dropdown").forEach((d) => {
    d.classList.remove("active");
  });
  activeDropdown = null;
  highlightedIndex = -1;
}

export function updateMailComposeSendState() {
  const modeEl = document.getElementById("mail-compose-mode");
  const sendBtn = document.getElementById("mail-compose-send-btn");
  if (!modeEl || !sendBtn) return;
  const requiresRecipient = modeEl.value === "ebp-encrypt";
  const rows = Array.from(document.querySelectorAll("[data-mail-recipient-row='true']"));
  const hasRecipient = rows.some((row) => {
    const contact = row.querySelector("input[data-mail-recipient-contact='true']");
    const email = row.querySelector("input[data-mail-recipient-email='true']");
    return Boolean(contact?.value?.trim() && email?.value?.trim());
  });
  sendBtn.disabled = requiresRecipient && !hasRecipient;
}

export function setMailTab(tabName) {
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

export function initMailTabs() {
  document.querySelectorAll("[data-mail-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setMailTab(btn.dataset.mailTab || "inbox");
    });
  });
  setMailTab(state.mailActiveTab || "inbox");
}

export function syncMailFolderCustomUi() {
  const folderEl = document.getElementById("mail-folder");
  const customWrap = document.getElementById("mail-folder-custom-wrap");
  if (!folderEl || !customWrap) return;
  customWrap.classList.toggle("visible", folderEl.value === "__custom__");
}

export function getSelectedMailFolder() {
  const folderEl = document.getElementById("mail-folder");
  const customEl = document.getElementById("mail-folder-custom");
  const folderValue = folderEl ? String(folderEl.value || "").trim() : "";
  if (folderValue === "__custom__") {
    return (customEl?.value || "").trim() || "INBOX";
  }
  return folderValue || "INBOX";
}
