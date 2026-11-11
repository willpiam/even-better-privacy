import { state } from "./state.js";

// Memory only: never persist mail bodies, attachments, or decrypted results.
export function createMailCache(maxEntries, maxBytes, ttlMs) {
  const entries = new Map();
  let bytes = 0;
  function remove(key) {
    const entry = entries.get(key);
    if (entry) bytes -= entry.bytes;
    entries.delete(key);
  }
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expires) { remove(key); return undefined; }
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value) {
      remove(key);
      const size = JSON.stringify(value).length * 2;
      if (size > maxBytes) return;
      entries.set(key, { value, bytes: size, expires: Date.now() + ttlMs });
      bytes += size;
      while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
    },
    clear() { entries.clear(); bytes = 0; },
  };
}

export const mailPageCache = createMailCache(30, 2 * 1024 * 1024, 5 * 60_000);
export const mailBodyCache = createMailCache(20, 16 * 1024 * 1024, 60_000);
const clearListeners = new Set();
let generation = 0;
export function mailCacheScope() {
  return JSON.stringify([generation, state.identityDirLabel, state.currentIdentity,
    state.currentFingerprint, state.selectedMailAccountId]);
}
export function onMailCacheClear(fn) { clearListeners.add(fn); }
export function clearMailCache() {
  generation += 1;
  mailPageCache.clear();
  mailBodyCache.clear();
  state.mailMessages = [];
  state.mailPagination = { page: 1, totalPages: 1, total: 0 };
  resetMailReader();
  for (const fn of clearListeners) fn();
}

export function resetMailReader() {
  state.selectedMailMessage = null;
  state.selectedMailMessageUid = null;
  state.selectedMailDecryptResult = null;
  state.decryptedMailAttachments = {};
  state.selectedMailMessageContentKey = null;
  state.selectedMailMessageAttachmentManifest = [];
  state.selectedMailMessageRecipientFingerprints = [];
  state.mailMessageLoadRequestId += 1;
  state.mailMessageLoading = false;
}
