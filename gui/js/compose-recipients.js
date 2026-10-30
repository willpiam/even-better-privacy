import { state, getDetailValue } from "./state.js";
import { api, escapeHtml } from "./ui.js";
import { loadAll } from "./render.js";
import { shortFingerprint } from "./fingerprint.js";
import { deriveComposeIntent, parseAddressList } from "./compose-recipients-logic.js";

export { deriveComposeIntent };

const LOCK_ICON =
  '<svg class="recipient-chip-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm1.5 0h5V5a2.5 2.5 0 0 0-5 0v2Z"/></svg>';

const STATE_TITLES = {
  resolving: "Looking up this address…",
  encrypted: "Encrypted for this contact",
  unresolved: "No EBP identity found. Click to choose a contact or send unencrypted.",
  plaintext: "Will be sent unencrypted",
  invalid: "Not a valid email address. Click to edit.",
};

let chips = [];
let nextChipId = 1;
let changeListener = null;
let resolveChipId = null;

function chipById(id) {
  return chips.find((chip) => chip.id === id) || null;
}

function contactEmail(contact) {
  return String(getDetailValue(contact.details, "email") || contact.localEmail || "").trim();
}

function contactSearchFields(contact) {
  return {
    name: String(contact.name || ""),
    fingerprint: String(contact.fingerprint || ""),
    email: contactEmail(contact),
    alias: String(contact.localAlias || ""),
    detailName: String(getDetailValue(contact.details, "name") || ""),
  };
}

function contactsWithEmail(email) {
  const key = email.toLowerCase();
  return state.contacts.filter((contact) => contactEmail(contact).toLowerCase() === key);
}

function emitChange() {
  renderChips();
  changeListener?.(getChips());
}

export function getChips() {
  return chips.map(({ email, state: chipState, contact, note }) => ({
    email,
    state: chipState,
    contact,
    note,
  }));
}

export function getComposeIntent() {
  return deriveComposeIntent(chips);
}

/** Replace all chips. Entries without a state are resolved. */
export function setChips(entries = []) {
  chips = [];
  addEntries(entries);
  emitChange();
}

function addEntries(entries) {
  const existing = chips.map((chip) => chip.email);
  for (const entry of entries) {
    const parsed = parseAddressList(entry.email, existing);
    if (!parsed.length) continue;
    const { email, valid } = parsed[0];
    existing.push(email);
    const chip = {
      id: nextChipId++,
      email,
      state: valid ? (entry.state || "resolving") : "invalid",
      contact: entry.contact || undefined,
      note: undefined,
      seq: 0,
    };
    if (chip.state === "encrypted" && !chip.contact) chip.state = "resolving";
    chips.push(chip);
    if (chip.state === "resolving") void resolveChip(chip.id);
  }
}

function addFromText(text) {
  const parsed = parseAddressList(text, chips.map((chip) => chip.email));
  if (!parsed.length) return;
  addEntries(parsed.map(({ email }) => ({ email })));
  emitChange();
}

function removeChip(id) {
  chips = chips.filter((chip) => chip.id !== id);
  emitChange();
}

function updateChip(id, patch) {
  const chip = chipById(id);
  if (!chip) return;
  Object.assign(chip, patch);
  emitChange();
}

async function resolveChip(id) {
  const chip = chipById(id);
  if (!chip) return;
  const seq = chip.seq + 1;
  chip.seq = seq;
  const stale = () => chipById(id)?.seq !== seq;

  const local = contactsWithEmail(chip.email);
  if (local.length === 1) {
    Object.assign(chip, { state: "encrypted", contact: local[0].name, note: undefined });
    emitChange();
    return;
  }
  if (local.length > 1) {
    Object.assign(chip, {
      state: "unresolved",
      contact: undefined,
      note: "More than one saved contact uses this address.",
    });
    emitChange();
    return;
  }

  Object.assign(chip, { state: "resolving", contact: undefined, note: undefined });
  emitChange();
  try {
    const result = await api(`/contacts/resolve-verified-email?email=${encodeURIComponent(chip.email)}`);
    if (stale()) return;
    if (result?.status === "unique" && result.name) {
      if (result.imported) await loadAll();
      if (stale()) return;
      updateChip(id, { state: "encrypted", contact: result.name, note: undefined });
      return;
    }
    updateChip(id, {
      state: "unresolved",
      contact: undefined,
      note: result?.status === "ambiguous"
        ? "More than one verified identity publishes this address."
        : undefined,
    });
  } catch (err) {
    if (stale()) return;
    updateChip(id, {
      state: "unresolved",
      contact: undefined,
      note: err?.message || "Identity lookup failed",
    });
  }
}

function chipLabel(chip) {
  if (chip.state === "encrypted" && chip.contact) {
    return `${LOCK_ICON}<span>${escapeHtml(chip.contact)}</span> <span class="recipient-chip-email">&lt;${escapeHtml(chip.email)}&gt;</span>`;
  }
  return `<span>${escapeHtml(chip.email)}</span>`;
}

function renderChips() {
  const list = document.getElementById("mail-compose-to-chip-list");
  if (!list) return;
  list.innerHTML = "";
  for (const chip of chips) {
    const li = document.createElement("li");
    li.className = "recipient-chip";
    li.dataset.state = chip.state;
    li.dataset.email = chip.email;
    const title = chip.note ? `${STATE_TITLES[chip.state]} ${chip.note}` : STATE_TITLES[chip.state];
    li.innerHTML = `
      <button type="button" class="recipient-chip-label" title="${escapeHtml(title)}">${chipLabel(chip)}</button>
      <button type="button" class="recipient-chip-remove" aria-label="Remove ${escapeHtml(chip.email)}">×</button>
    `;
    li.querySelector(".recipient-chip-label").addEventListener("click", () => onChipClick(chip.id));
    li.querySelector(".recipient-chip-remove").addEventListener("click", () => removeChip(chip.id));
    list.appendChild(li);
  }
}

function onChipClick(id) {
  const chip = chipById(id);
  if (!chip || chip.state === "resolving") return;
  if (chip.state === "invalid") {
    const input = document.getElementById("mail-compose-to-input");
    removeChip(id);
    if (input) {
      input.value = chip.email;
      input.focus();
    }
    return;
  }
  openResolveModal(id);
}

function resolveModalEls() {
  return {
    modal: document.getElementById("mail-recipient-resolve-modal"),
    email: document.getElementById("mail-recipient-resolve-email"),
    message: document.getElementById("mail-recipient-resolve-message"),
    search: document.getElementById("mail-recipient-resolve-search"),
    list: document.getElementById("mail-recipient-resolve-list"),
  };
}

function openResolveModal(id) {
  const chip = chipById(id);
  const els = resolveModalEls();
  if (!chip || !els.modal) return;
  resolveChipId = id;
  if (els.email) els.email.textContent = chip.email;
  if (els.message) {
    const base = chip.state === "encrypted"
      ? `Encrypting for ${chip.contact}. Pick a different contact, or send to this address without encryption.`
      : chip.state === "plaintext"
      ? "This address is set to receive the message unencrypted. Pick a contact to encrypt for it instead."
      : "No EBP identity was found for this address. Pick a contact to encrypt for, or send to it without encryption.";
    els.message.textContent = chip.note ? `${base} ${chip.note}` : base;
  }
  if (els.search) els.search.value = "";
  renderResolveList("");
  els.modal.classList.add("active");
  els.search?.focus();
}

function closeResolveModal() {
  resolveChipId = null;
  resolveModalEls().modal?.classList.remove("active");
}

function renderResolveList(queryRaw) {
  const { list } = resolveModalEls();
  const chip = chipById(resolveChipId);
  if (!list || !chip) return;
  const query = String(queryRaw || "").trim().toLowerCase();
  const emailKey = chip.email.toLowerCase();
  const matches = state.contacts
    .filter((contact) => {
      if (!query) return true;
      const fields = contactSearchFields(contact);
      return [fields.name, fields.detailName, fields.alias, fields.email, fields.fingerprint]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .sort((a, b) => {
      const aMatch = contactEmail(a).toLowerCase() === emailKey ? 0 : 1;
      const bMatch = contactEmail(b).toLowerCase() === emailKey ? 0 : 1;
      return aMatch - bMatch;
    })
    .slice(0, 20);
  list.innerHTML = "";
  if (!matches.length) {
    list.innerHTML = '<li class="contact-search-no-results">No matching contacts</li>';
    return;
  }
  for (const contact of matches) {
    const fields = contactSearchFields(contact);
    const li = document.createElement("li");
    li.className = "contact-search-item";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    li.dataset.contactName = fields.name;
    const detail = [fields.detailName, fields.alias && `alias: ${fields.alias}`, fields.email]
      .filter(Boolean)
      .join(" • ");
    li.innerHTML = `
      <div class="contact-search-item-name">${escapeHtml(fields.name || "(no name)")}</div>
      <div class="contact-search-item-details"><span class="contact-search-item-detail">${escapeHtml(detail)}</span></div>
      <div class="contact-search-item-fingerprint">${escapeHtml(shortFingerprint(fields.fingerprint))}</div>
    `;
    const choose = () => {
      const id = resolveChipId;
      closeResolveModal();
      updateChip(id, { state: "encrypted", contact: fields.name, note: undefined });
    };
    li.addEventListener("click", choose);
    li.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        choose();
      }
    });
    list.appendChild(li);
  }
}

function commitInput(input) {
  const text = input.value;
  input.value = "";
  addFromText(text);
}

export function initComposeRecipients({ onChange } = {}) {
  changeListener = onChange || null;
  const input = document.getElementById("mail-compose-to-input");
  const field = document.getElementById("mail-compose-to-chips");
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "," || event.key === ";" || event.key === "Enter") {
        event.preventDefault();
        commitInput(input);
        return;
      }
      if (event.key === "Backspace" && !input.value && chips.length) {
        event.preventDefault();
        removeChip(chips[chips.length - 1].id);
      }
    });
    input.addEventListener("input", () => {
      if (!/[,;\n]/.test(input.value)) return;
      const parts = input.value.split(/[,;\n]/);
      const tail = parts.pop() || "";
      input.value = tail;
      addFromText(parts.join(","));
    });
    input.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text") ?? "";
      if (!/[,;\n]/.test(pasted)) return;
      event.preventDefault();
      const text = `${input.value},${pasted}`;
      input.value = "";
      addFromText(text);
    });
    input.addEventListener("blur", () => commitInput(input));
  }
  field?.addEventListener("click", (event) => {
    if (event.target === field) input?.focus();
  });

  const els = resolveModalEls();
  els.search?.addEventListener("input", () => renderResolveList(els.search.value));
  document.getElementById("mail-recipient-resolve-cancel")?.addEventListener("click", closeResolveModal);
  document.getElementById("mail-recipient-resolve-plaintext")?.addEventListener("click", () => {
    const id = resolveChipId;
    closeResolveModal();
    updateChip(id, { state: "plaintext", contact: undefined, note: undefined });
  });
  els.modal?.addEventListener("click", (event) => {
    if (event.target === els.modal) closeResolveModal();
  });
  els.modal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeResolveModal();
  });
  renderChips();
}
