#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${ROOT}/desktop"
BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle/msi"
MSI_OUTPUT="${ROOT}/EBP.msi"
ENV_FILE="${ROOT}/.env.desktop.build"
ENV_FILE_ALT="${ROOT}/env.desktop.build"

echo "Building EBP desktop app for Windows (MSI)..."
echo "Note: this script should run on Windows unless you have a configured cross-compilation toolchain."

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    ;;
  *)
    echo "ERROR: Windows build requested, but host OS is $(uname -s)."
    echo "Run this in a Windows environment, or configure cross-compilation first."
    exit 1
    ;;
esac

if [ -f "${ENV_FILE}" ]; then
  echo "Loading build-only env from ${ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
elif [ -f "${ENV_FILE_ALT}" ]; then
  echo "Loading build-only env from ${ENV_FILE_ALT} (dotfile variant not found)"
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE_ALT}"
  set +a
else
  echo "No build-only env file found at ${ENV_FILE} (continuing with current environment)."
fi

cd "${DESKTOP_DIR}"
npm ci

# Ensure the Tauri distDir (desktop/dist) exists with the bootstrap page.
# This directory is git-ignored by the top-level dist/ rule, so it may be
# missing on a fresh clone.
if [ ! -f "${DESKTOP_DIR}/dist/index.html" ]; then
  echo "Creating desktop/dist/index.html (missing from working tree)…"
  mkdir -p "${DESKTOP_DIR}/dist"
  cat > "${DESKTOP_DIR}/dist/index.html" << 'BOOTSTRAP'
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>EBP</title>
  <style>
    body {
      margin: 0;
      background: #0d1117;
      color: #e6edf3;
      font-family: -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }
    .loader {
      text-align: center;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #30363d;
      border-top-color: #58a6ff;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
      margin: 0 auto 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .status { font-size: 0.9rem; color: #8b949e; }
    .error  { color: #f85149; }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner" id="spinner"></div>
    <div class="status" id="status">Starting local backend…</div>
  </div>
  <script>
    const BACKEND = "http://127.0.0.1:8787";
    const MAX_ATTEMPTS = 30;
    const DELAY_MS = 500;

    async function waitForBackend() {
      const status = document.getElementById("status");
      for (let i = 1; i <= MAX_ATTEMPTS; i++) {
        try {
          const res = await fetch(BACKEND + "/api/v1/health");
          if (res.ok) {
            window.location.replace(BACKEND);
            return;
          }
        } catch (_) {
          // not ready yet
        }
        status.textContent = "Starting local backend… (" + i + "/" + MAX_ATTEMPTS + ")";
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
      document.getElementById("spinner").style.display = "none";
      status.className = "status error";
      status.textContent = "Could not reach local backend at " + BACKEND + ". Is the sidecar running?";
    }

    waitForBackend();
  </script>
</body>
</html>
BOOTSTRAP
fi

# Override tauri.conf bundle target and build Windows installer.
npm run build -- --bundles msi

LATEST_MSI="$(find "${BUNDLE_DIR}" -maxdepth 1 -type f -name "*.msi" | sort | tail -n 1 || true)"
if [ -z "${LATEST_MSI}" ]; then
  echo "ERROR: No MSI produced in ${BUNDLE_DIR}"
  exit 1
fi

cp -f "${LATEST_MSI}" "${MSI_OUTPUT}"

echo ""
echo "=== Windows build completed ==="
echo "  MSI: ${MSI_OUTPUT}"
