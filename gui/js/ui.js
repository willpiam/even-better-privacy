import { LOCAL_BACKEND_ORIGIN } from "./state.js";

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
  const res = await fetch(`${LOCAL_BACKEND_ORIGIN}/api/v1${path}`, {
    headers: { "content-type": "application/json" },
    ...init,
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
