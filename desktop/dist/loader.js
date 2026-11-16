const BACKEND = "http://127.0.0.1:8787";
const MAX_ATTEMPTS = 30;
const DELAY_MS = 500;

async function waitForBackend() {
  const status = document.getElementById("status");
  const spinner = document.getElementById("spinner");
  const retry = document.getElementById("retry");
  retry.hidden = true;
  spinner.hidden = false;
  status.textContent = "Opening your workspace…";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(`${BACKEND}/api/v1/health`, { signal: controller.signal });
      if (res.ok) {
        window.location.replace(BACKEND);
        return;
      }
    } catch { /* The local sidecar may still be starting. */ }
    finally { clearTimeout(timer); }
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }
  spinner.hidden = true;
  status.textContent = "The local service hasn’t started yet. Try again, or reopen the application.";
  retry.hidden = false;
}

document.getElementById("retry").addEventListener("click", waitForBackend);
void waitForBackend();
