// Presentation split for pqpost chat. The message is still EBP email.
// `X-EBP-Channel: chat` tells clients to file it in Chat instead of Mail.

import { normalizeEmail } from "./MailAuthenticity.ts";

export const EBP_CHAT_HEADER = "X-EBP-Channel";
export const EBP_CHAT_HEADER_VALUE = "chat";
export const EBP_CHAT_SUBJECT = "Chat";
export const EBP_CHAT_UID_CAP = 200;
export const EBP_CHAT_THREAD_BODY_CAP = 40;

export type ChatFolderKind = "inbox" | "sent";

export type ChatSourceMessage = {
  uid: number;
  folder: string;
  folderKind: ChatFolderKind;
  from: string;
  to: string;
  date: number | null;
  seen: boolean;
  messageId: string | null;
};

export type ChatThreadMessage = ChatSourceMessage & {
  outbound: boolean;
};

export type ChatConversation = {
  peer: string;
  latestDate: number | null;
  unread: number;
  messages: ChatThreadMessage[];
};

export function isChatChannelHeader(value: string | null | undefined): boolean {
  return (value ?? "").trim().toLowerCase() === EBP_CHAT_HEADER_VALUE;
}

export function emailDomain(value: string): string {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  return email.slice(at + 1);
}

/** True when peer is someone else on the same mail domain as the account. */
export function chatPeerAllowed(ownAddress: string, peerAddress: string): boolean {
  const own = normalizeEmail(ownAddress);
  const peer = normalizeEmail(peerAddress);
  if (!own || !peer || own === peer) return false;
  const domain = emailDomain(own);
  return domain.length > 0 && domain === emailDomain(peer);
}

export function formatMessageId(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed.replace(/^<|>$/g, "")}>`;
}

export function generateMessageId(ownAddress: string): string {
  const domain = emailDomain(ownAddress) || "localhost";
  return `<${randomToken()}@${domain}>`;
}

type RandomSource = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

function randomToken(): string {
  const cryptoApi = (globalThis as { crypto?: RandomSource }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function peerAddress(message: ChatSourceMessage, ownAddress: string): string | null {
  const own = normalizeEmail(ownAddress);
  const candidate = message.folderKind === "sent" ? message.to : message.from;
  const peer = normalizeEmail(candidate);
  if (!peer || peer === own) return null;
  return peer;
}

/** Group chat-channel messages by the other person's address. Oldest first. */
export function groupChatConversations(
  messages: readonly ChatSourceMessage[],
  ownAddress: string,
): ChatConversation[] {
  const byPeer = new Map<string, ChatThreadMessage[]>();
  for (const message of messages) {
    const peer = peerAddress(message, ownAddress);
    if (!peer) continue;
    const row: ChatThreadMessage = {
      ...message,
      outbound: message.folderKind === "sent",
    };
    const list = byPeer.get(peer) ?? [];
    list.push(row);
    byPeer.set(peer, list);
  }
  const conversations: ChatConversation[] = [];
  for (const [peer, rows] of byPeer) {
    rows.sort((a, b) => (a.date ?? 0) - (b.date ?? 0) || a.uid - b.uid);
    const latest = rows[rows.length - 1];
    conversations.push({
      peer,
      latestDate: latest?.date ?? null,
      unread: rows.filter((row) => !row.outbound && !row.seen).length,
      messages: rows,
    });
  }
  conversations.sort((a, b) => (b.latestDate ?? 0) - (a.latestDate ?? 0) || a.peer.localeCompare(b.peer));
  return conversations;
}

export function messagesForThreadBodies<T>(
  messages: readonly T[],
  cap = EBP_CHAT_THREAD_BODY_CAP,
): { hiddenCount: number; shown: T[] } {
  if (messages.length <= cap) {
    return { hiddenCount: 0, shown: [...messages] };
  }
  return {
    hiddenCount: messages.length - cap,
    shown: messages.slice(messages.length - cap),
  };
}

export function latestThreadingTarget(
  messages: readonly { messageId: string | null }[],
): { inReplyTo: string; references: string } | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const formatted = formatMessageId(messages[i]?.messageId);
    if (formatted) return { inReplyTo: formatted, references: formatted };
  }
  return null;
}
