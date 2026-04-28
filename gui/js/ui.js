import { LOCAL_BACKEND_ORIGIN, TOAST_LOG_LIMIT, state } from "./state.js";

let csrfTokenPromise = null;
function getCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch(`${LOCAL_BACKEND_ORIGIN}/api/v1/csrf-token`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`failed to fetch csrf token: HTTP ${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (!body || typeof body.token !== "string") throw new Error("csrf token missing");
        return body.token;
      })
      .catch((err) => {
        csrfTokenPromise = null;
        throw err;
      });
  }
  return csrfTokenPromise;
}

const statusEl = document.getElementById("status");
const statusSubscribers = new Set();
let statusCopyFeedbackTimer = null;

let statusTimer = null;
function notifyStatusSubscribers() {
  for (const subscriber of statusSubscribers) {
    try {
      subscriber();
    } catch (err) {
      console.error("status subscriber failed", err);
    }
  }
}

export function onStatusChange(subscriber) {
  if (typeof subscriber !== "function") return () => {};
  statusSubscribers.add(subscriber);
  return () => statusSubscribers.delete(subscriber);
}

function pushToastLog(message, kind) {
  state.toastLogs.unshift({
    message,
    kind,
    timestamp: Date.now(),
  });
  if (state.toastLogs.length > TOAST_LOG_LIMIT) {
    state.toastLogs.length = TOAST_LOG_LIMIT;
  }
}

export function setStatus(msg, kind = "info", options = {}) {
  const { log = true } = options;
  const message = typeof msg === "string" ? msg : String(msg ?? "");
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  statusEl.textContent = message;
  statusEl.dataset.kind = kind;
  delete statusEl.dataset.copied;
  statusEl.title = "Click to copy";
  statusEl.classList.remove("hidden");
  statusEl.style.animation = "none";
  statusEl.offsetHeight;
  statusEl.style.animation = "";
  if (log) pushToastLog(message, kind);
  notifyStatusSubscribers();
  if (kind !== "error") {
    statusTimer = setTimeout(() => { statusEl.classList.add("hidden"); }, 5000);
  }
}

if (statusEl) {
  statusEl.addEventListener("click", async () => {
    const message = statusEl.textContent?.trim();
    if (!message || statusEl.classList.contains("hidden")) return;
    try {
      await navigator.clipboard.writeText(message);
      statusEl.dataset.copied = "true";
      statusEl.title = "Copied";
      if (statusCopyFeedbackTimer) clearTimeout(statusCopyFeedbackTimer);
      statusCopyFeedbackTimer = setTimeout(() => {
        delete statusEl.dataset.copied;
        statusEl.title = "Click to copy";
      }, 1200);
    } catch (err) {
      console.error("Failed to copy status", err);
      statusEl.title = "Copy failed";
      if (statusCopyFeedbackTimer) clearTimeout(statusCopyFeedbackTimer);
      statusCopyFeedbackTimer = setTimeout(() => {
        statusEl.title = "Click to copy";
      }, 1200);
    }
  });
}

export function setButtonLoading(btn, loading) {
  if (loading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

export async function withLoading(btn, fn) {
  setButtonLoading(btn, true);
  try {
    await fn();
  } finally {
    setButtonLoading(btn, false);
  }
}

export async function api(path, init = {}) {
  const method = (init.method || "GET").toUpperCase();
  const needsCsrf = method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && path !== "/csrf-token";
  const extraHeaders = {};
  if (needsCsrf) {
    try {
      extraHeaders["x-ebp-csrf"] = await getCsrfToken();
    } catch (err) {
      throw new Error(`failed to obtain csrf token: ${err && err.message ? err.message : err}`);
    }
  }
  let res;
  try {
    res = await fetch(`${LOCAL_BACKEND_ORIGIN}/api/v1${path}`, {
      credentials: "include",
      ...init,
      headers: { "content-type": "application/json", ...extraHeaders, ...(init.headers || {}) },
    });
  } catch (err) {
    const maybeAbort = err && typeof err === "object" ? err.name : "";
    if (maybeAbort === "AbortError") throw new Error("request aborted");
    throw err;
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // ignore
  }
  if (!res.ok) {
    const msg = body && body.error ? body.error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
