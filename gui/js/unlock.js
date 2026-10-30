import {
  AUTO_LOCK_MINUTES_PREF_KEY,
  DEFAULT_AUTO_LOCK_MINUTES,
  saveNumberPreference,
  state,
} from "./state.js";
import { api, setStatus } from "./ui.js";
import { requestPassword } from "./modals.js";

export const IDENTITY_LOCKED_MESSAGE = "identity locked";
const DEFAULT_UNLOCK_PROMPT = "Enter your identity password to unlock";
const MAX_UNLOCK_ATTEMPTS = 3;
const STATUS_POLL_MS = 30_000;

export class UnlockCancelledError extends Error {
  constructor(message = "Unlock cancelled") {
    super(message);
    this.name = "UnlockCancelledError";
  }
}

const subscribers = new Set();
let unlockInFlight = null;
let pollTimer = null;
let expiryTimer = null;

export function isIdentityLockedError(err) {
  return Boolean(err) && err.message === IDENTITY_LOCKED_MESSAGE;
}

export function isUnlockCancelled(err) {
  return err instanceof UnlockCancelledError;
}

/** Last known unlock state for the current identity (sync, no request). */
export function isIdentityUnlocked() {
  return state.identityUnlocked === true;
}

export function onUnlockStatusChange(fn) {
  if (typeof fn !== "function") return () => {};
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

function applyStatus(status) {
  const unlocked = Boolean(status?.unlocked);
  const changed = unlocked !== state.identityUnlocked;
  state.identityUnlocked = unlocked;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (unlocked && typeof status.remainingMs === "number") {
    expiryTimer = setTimeout(() => {
      refreshUnlockStatus().catch(() => {});
    }, status.remainingMs + 500);
  }
  renderUnlockPill();
  if (changed) {
    for (const fn of subscribers) {
      try {
        fn(unlocked);
      } catch (err) {
        console.error("unlock subscriber failed", err);
      }
    }
  }
}

export async function refreshUnlockStatus() {
  const status = await api("/identity/unlock-status");
  applyStatus(status);
  return state.identityUnlocked;
}

function autoLockMinutes() {
  const n = Number(state.autoLockMinutes);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AUTO_LOCK_MINUTES;
}

async function promptAndUnlock(promptText) {
  for (let attempt = 0; attempt < MAX_UNLOCK_ATTEMPTS; attempt++) {
    const password = await requestPassword(
      attempt === 0 ? promptText : "Wrong password. Try again",
    );
    if (!password) return false;
    try {
      const status = await api("/identity/unlock", {
        method: "POST",
        body: JSON.stringify({
          password,
          timeoutMinutes: autoLockMinutes(),
        }),
      });
      applyStatus(status);
      return true;
    } catch (err) {
      if (!/wrong password|failed to decrypt/i.test(err.message)) throw err;
      setStatus("Wrong password", "error");
    }
  }
  return false;
}

/**
 * Prompt for the identity password once and open a backend unlock session.
 * Concurrent callers share one prompt. Resolves false if the user cancels.
 */
export function unlockIdentity(promptText = DEFAULT_UNLOCK_PROMPT) {
  if (!unlockInFlight) {
    unlockInFlight = promptAndUnlock(promptText).finally(() => {
      unlockInFlight = null;
    });
  }
  return unlockInFlight;
}

/** Prompt only when the backend reports the identity locked. */
export async function ensureIdentityUnlocked(promptText = DEFAULT_UNLOCK_PROMPT) {
  try {
    if (await refreshUnlockStatus()) return true;
  } catch {
    // Fall through to prompting; the unlock call reports real errors.
  }
  return unlockIdentity(promptText);
}

/**
 * Run a private-key request. On 401 `identity locked`, prompt once, unlock,
 * and retry. Throws UnlockCancelledError if the user dismisses the prompt.
 */
export async function withIdentity(fn, promptText = DEFAULT_UNLOCK_PROMPT) {
  try {
    const result = await fn({});
    if (!state.identityUnlocked) refreshUnlockStatus().catch(() => {});
    return result;
  } catch (err) {
    if (!isIdentityLockedError(err)) throw err;
    applyStatus({ unlocked: false });
    if (!(await unlockIdentity(promptText))) throw new UnlockCancelledError();
    return fn({});
  }
}

export async function lockIdentity() {
  const status = await api("/identity/lock", {
    method: "POST",
    body: JSON.stringify({ all: true }),
  });
  applyStatus(status);
  state.mailSecretsInMemory = false;
  return status;
}

export async function setAutoLockMinutes(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return;
  state.autoLockMinutes = n;
  saveNumberPreference(AUTO_LOCK_MINUTES_PREF_KEY, n);
  if (state.identityUnlocked) {
    const status = await api("/identity/unlock-timeout", {
      method: "POST",
      body: JSON.stringify({ timeoutMinutes: n }),
    });
    applyStatus(status);
  }
}

function renderUnlockPill() {
  const pill = document.getElementById("ctx-unlock-pill");
  const label = document.getElementById("ctx-unlock-label");
  const btn = document.getElementById("ctx-unlock-btn");
  if (!pill || !label || !btn) return;
  const unlocked = state.identityUnlocked;
  pill.dataset.state = unlocked ? "unlocked" : "locked";
  label.textContent = unlocked ? "Unlocked" : "Locked";
  btn.textContent = unlocked ? "Lock" : "Unlock";
}

export function initUnlockUi() {
  const btn = document.getElementById("ctx-unlock-btn");
  btn?.addEventListener("click", async () => {
    try {
      if (state.identityUnlocked) {
        await lockIdentity();
        setStatus("Identity locked", "success");
      } else if (await unlockIdentity()) {
        setStatus("Identity unlocked", "success");
      }
    } catch (err) {
      setStatus(err.message, "error");
    }
  });

  const select = document.getElementById("settings-auto-lock-minutes");
  if (select) {
    const current = String(autoLockMinutes());
    if (![...select.options].some((o) => o.value === current)) {
      const option = document.createElement("option");
      option.value = current;
      option.textContent = `${current} minutes`;
      select.appendChild(option);
    }
    select.value = current;
    select.addEventListener("change", () => {
      setAutoLockMinutes(select.value).catch((err) =>
        setStatus(err.message, "error")
      );
    });
  }

  renderUnlockPill();
  refreshUnlockStatus().catch(() => {});
  if (!pollTimer) {
    pollTimer = setInterval(() => {
      refreshUnlockStatus().catch(() => {});
    }, STATUS_POLL_MS);
  }
}
