import { state, getDetailValue } from "./state.js";
import { api, escapeHtml, setStatus } from "./ui.js";
import { isUnlockCancelled, withIdentity } from "./unlock.js";
import { ensureMailPageUnlocked, openMailMessage } from "./mail.js";

const REFRESH_MS = 20_000;
const BODY_CAP = 40;

let conversations = [];
let selectedPeer = "";
let selectedContact = "";
let refreshTimer = null;
let loadGen = 0;
const bubbleCache = new Map();

function ownAddress() {
  return String(state.mailAccount?.fromEmail || state.mailAccount?.username || "").trim();
}

function normalizeEmail(value) {
  const trimmed = String(value || "").trim();
  const angle = trimmed.match(/<([^>]+)>/);
  return (angle?.[1] ?? trimmed).trim().toLowerCase();
}

function domainOf(email) {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1) : "";
}

function peerAllowed(peer) {
  const own = normalizeEmail(ownAddress());
  const other = normalizeEmail(peer);
  if (!own || !other || own === other) return false;
  const domain = domainOf(own);
  return Boolean(domain) && domain === domainOf(other);
}

function contactEmail(contact) {
  return String(getDetailValue(contact.details, "email") || contact.localEmail || "").trim();
}

function contactNameFor(email) {
  const key = normalizeEmail(email);
  const matches = state.contacts.filter((contact) => normalizeEmail(contactEmail(contact)) === key);
  return matches.length === 1 ? matches[0].name : "";
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function selectedMessages() {
  const found = conversations.find((item) => item.peer === selectedPeer);
  return found?.messages || [];
}

function syncSendButton() {
  const button = document.getElementById("chat-send-btn");
  const body = document.getElementById("chat-compose-body");
  if (!button || !body) return;
  const text = body.value.trim();
  button.disabled = !selectedPeer || !text;
}

function renderConversationList() {
  const list = document.getElementById("chat-conversation-list");
  if (!list) return;
  list.innerHTML = "";
  if (!conversations.length && !selectedPeer) {
    list.innerHTML = "<li class='muted'>(no chats)</li>";
    return;
  }
  const peers = conversations.map((item) => item.peer);
  if (selectedPeer && !peers.includes(selectedPeer)) {
    const li = document.createElement("li");
    li.className = "clickable current";
    li.textContent = selectedContact ? `${selectedContact} <${selectedPeer}>` : selectedPeer;
    list.appendChild(li);
  }
  for (const item of conversations) {
    const li = document.createElement("li");
    li.className = item.peer === selectedPeer ? "clickable current" : "clickable";
    const label = contactNameFor(item.peer) || item.peer;
    const unread = item.unread ? ` (${item.unread})` : "";
    li.innerHTML = `
      <div>${escapeHtml(label)}${escapeHtml(unread)}</div>
      <div class="small muted">${escapeHtml(formatWhen(item.latestDate))}</div>
    `;
    li.addEventListener("click", () => {
      void selectPeer(item.peer, contactNameFor(item.peer));
    });
    list.appendChild(li);
  }
}

function renderThread() {
  const header = document.getElementById("chat-thread-header");
  const thread = document.getElementById("chat-thread");
  if (!header || !thread) return;
  if (!selectedPeer) {
    header.textContent = "Select a conversation";
    thread.innerHTML = "";
    syncSendButton();
    return;
  }
  const label = selectedContact || contactNameFor(selectedPeer) || selectedPeer;
  header.textContent = label === selectedPeer ? selectedPeer : `${label} <${selectedPeer}>`;
  const messages = selectedMessages();
  const hidden = Math.max(0, messages.length - BODY_CAP);
  const shown = messages.slice(-BODY_CAP);
  thread.innerHTML = "";
  if (hidden > 0) {
    const note = document.createElement("p");
    note.className = "small muted";
    note.textContent = `${hidden} earlier messages are not loaded`;
    thread.appendChild(note);
  }
  if (!shown.length) {
    const empty = document.createElement("p");
    empty.className = "small muted";
    empty.textContent = "No messages yet";
    thread.appendChild(empty);
  }
  for (const message of shown) {
    const key = `${message.folder}:${message.uid}`;
    const cached = bubbleCache.get(key);
    const bubble = document.createElement("div");
    const when = document.createElement("time");
    when.textContent = formatWhen(message.date);
    if (!cached) {
      bubble.className = message.outbound ? "chat-bubble outbound" : "chat-bubble inbound";
      bubble.textContent = "Encrypted";
      bubble.appendChild(when);
    } else if (cached.ok) {
      bubble.className = message.outbound ? "chat-bubble outbound" : "chat-bubble inbound";
      bubble.textContent = cached.text;
      bubble.appendChild(when);
    } else {
      bubble.className = "chat-bubble error";
      bubble.textContent = "This message could not be verified.";
      const open = document.createElement("button");
      open.type = "button";
      open.className = "secondary";
      open.textContent = "Open in Mail";
      open.addEventListener("click", () => {
        document.querySelector('.nav-item[data-page="mail"]')?.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
        void openMailMessage(message.folder, message.uid);
      });
      bubble.appendChild(document.createElement("br"));
      bubble.appendChild(open);
      bubble.appendChild(when);
    }
    thread.appendChild(bubble);
  }
  thread.scrollTop = thread.scrollHeight;
  syncSendButton();
}

async function resolveContact(email) {
  const localName = contactNameFor(email);
  if (localName) return localName;
  const localCount = state.contacts.filter((contact) =>
    normalizeEmail(contactEmail(contact)) === email
  ).length;
  if (localCount > 1) {
    throw new Error("More than one saved contact uses this address.");
  }
  const result = await api(
    `/contacts/resolve-verified-email?email=${encodeURIComponent(email)}`,
  );
  if (result?.status === "unique" && result.name) return result.name;
  if (result?.status === "ambiguous") {
    throw new Error("More than one verified identity publishes this address.");
  }
  throw new Error("No verified identity for that address.");
}

async function markSeen(messages) {
  const byFolder = new Map();
  for (const message of messages) {
    if (message.outbound || message.seen) continue;
    const list = byFolder.get(message.folder) ?? [];
    list.push(message.uid);
    byFolder.set(message.folder, list);
  }
  for (const [folder, uids] of byFolder) {
    await api("/mail/message/seen", {
      method: "POST",
      body: JSON.stringify({
        folder,
        uids,
        accountId: state.selectedMailAccountId || undefined,
      }),
    });
  }
}

async function decryptShown(gen) {
  const shown = selectedMessages().slice(-BODY_CAP);
  for (const message of shown) {
    if (gen !== loadGen) return;
    const key = `${message.folder}:${message.uid}`;
    if (bubbleCache.has(key)) continue;
    try {
      const accountQ = state.selectedMailAccountId
        ? `&accountId=${encodeURIComponent(state.selectedMailAccountId)}`
        : "";
      const detail = await api(
        `/mail/message?folder=${encodeURIComponent(message.folder)}&uid=${encodeURIComponent(String(message.uid))}${accountQ}`,
      );
      if (gen !== loadGen) return;
      if (!detail?.ebpPayload) {
        bubbleCache.set(key, { ok: false });
        renderThread();
        continue;
      }
      const res = await withIdentity(() => api("/decrypt", {
        method: "POST",
        body: JSON.stringify({
          payload: detail.ebpPayload,
          messageFrom: detail.from || undefined,
        }),
      }), "Enter your identity password to read this chat");
      if (gen !== loadGen) return;
      if (res?.verified === true && typeof res.message === "string") {
        bubbleCache.set(key, { ok: true, text: res.message });
      } else {
        bubbleCache.set(key, { ok: false });
      }
    } catch (err) {
      if (isUnlockCancelled(err)) return;
      bubbleCache.set(key, { ok: false });
    }
    renderThread();
  }
}

async function selectPeer(peer, contactName) {
  selectedPeer = normalizeEmail(peer);
  selectedContact = contactName || contactNameFor(selectedPeer) || "";
  renderConversationList();
  renderThread();
  const gen = loadGen;
  const messages = selectedMessages();
  try {
    await markSeen(messages);
  } catch (err) {
    setStatus(err.message, "error");
  }
  await decryptShown(gen);
}

async function refreshConversations() {
  const page = document.getElementById("page-chat");
  if (!page?.classList.contains("active")) return;
  const gen = ++loadGen;
  const accountQ = state.selectedMailAccountId
    ? `?accountId=${encodeURIComponent(state.selectedMailAccountId)}`
    : "";
  const res = await api(`/mail/chat${accountQ}`);
  if (gen !== loadGen) return;
  conversations = Array.isArray(res?.conversations) ? res.conversations : [];
  renderConversationList();
  renderThread();
  if (selectedPeer) await decryptShown(gen);
}

export async function openChatPage() {
  const unlocked = await ensureMailPageUnlocked();
  if (!unlocked) return;
  try {
    await refreshConversations();
  } catch (err) {
    setStatus(err.message, "error");
  }
}

export function initChatPage() {
  const form = document.getElementById("chat-new-form");
  const compose = document.getElementById("chat-compose-form");
  const body = document.getElementById("chat-compose-body");
  body?.addEventListener("input", syncSendButton);
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.getElementById("chat-new-status");
    const email = normalizeEmail(document.getElementById("chat-new-address")?.value || "");
    if (!peerAllowed(email)) {
      if (status) status.textContent = "Use an address on your mail domain.";
      return;
    }
    try {
      const name = await resolveContact(email);
      if (status) status.textContent = "";
      await selectPeer(email, name);
    } catch (err) {
      if (status) status.textContent = err.message || "Lookup failed";
    }
  });
  compose?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = body?.value.trim() || "";
    if (!selectedPeer || !text) return;
    const button = document.getElementById("chat-send-btn");
    if (button) button.disabled = true;
    try {
      const contact = selectedContact || await resolveContact(selectedPeer);
      selectedContact = contact;
      const thread = latestMessageId(selectedMessages());
      await withIdentity(() => api("/mail/send-ebp", {
        method: "POST",
        body: JSON.stringify({
          channel: "chat",
          to: selectedPeer,
          recipient: contact,
          recipients: [{ contact, email: selectedPeer }],
          message: text,
          includePublicKeys: state.mailIncludePublicKeys,
          accountId: state.selectedMailAccountId || undefined,
          inReplyTo: thread.inReplyTo,
          references: thread.references,
        }),
      }), "Enter your identity password to send this chat");
      if (body) body.value = "";
      setStatus("Message sent", "success");
      await refreshConversations();
    } catch (err) {
      if (!isUnlockCancelled(err)) setStatus(err.message, "error");
    } finally {
      syncSendButton();
    }
  });
  if (refreshTimer === null) {
    refreshTimer = setInterval(() => {
      void refreshConversations().catch((err) => setStatus(err.message, "error"));
    }, REFRESH_MS);
  }
}

function latestMessageId(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const raw = String(messages[i]?.messageId || "").trim();
    if (!raw) continue;
    const formatted = raw.startsWith("<") ? raw : `<${raw}>`;
    return { inReplyTo: formatted, references: formatted };
  }
  return {};
}
