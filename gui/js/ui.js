import { LOCAL_BACKEND_ORIGIN } from "./state.js";

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

let statusTimer = null;
export function setStatus(msg, kind = "info") {
  if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; }
  statusEl.textContent = msg;
  statusEl.dataset.kind = kind;
  statusEl.classList.remove("hidden");
  statusEl.style.animation = "none";
  statusEl.offsetHeight;
  statusEl.style.animation = "";
  if (kind !== "error") {
    statusTimer = setTimeout(() => { statusEl.classList.add("hidden"); }, 5000);
  }
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
  const res = await fetch(`${LOCAL_BACKEND_ORIGIN}/api/v1${path}`, {
    credentials: "include",
    ...init,
    headers: { "content-type": "application/json", ...extraHeaders, ...(init.headers || {}) },
  });
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
