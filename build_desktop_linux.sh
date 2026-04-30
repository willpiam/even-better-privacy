#!/usr/bin/env bash
set -euo pipefail

echo "Prereqs (once): sudo apt install libwebkit2gtk-4.0-dev libssl-dev build-essential"

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APPIMAGE_DIR="${ROOT}/desktop/src-tauri/target/release/bundle/appimage"
ENV_FILE="${ROOT}/.env.desktop.build"
ENV_FILE_ALT="${ROOT}/env.desktop.build"

rm -rf "${APPIMAGE_DIR}/ebp.AppDir"

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

cd "${ROOT}"

# Always rebuild the Deno sidecar BEFORE tauri build.  The tauri CLI's
# beforeBuildCommand may not execute if the Node.js version is too old
# for @tauri-apps/cli (optional chaining syntax requires Node 14+).
echo "Building desktop sidecar (Deno compile)…"
deno run --allow-run --allow-read --allow-write --allow-env ./scripts/build_desktop_backend_sidecar.ts

cd "${ROOT}/desktop"
npm ci

# Patch the cached gtk plugin so 'ln -s' becomes 'ln -sf' (avoids "File exists" errors).
GTK_PLUGIN="${HOME}/.cache/tauri/linuxdeploy-plugin-gtk.sh"
if [ -f "${GTK_PLUGIN}" ]; then
  sed -i 's/ln \$verbose -s /ln \$verbose -sf /g' "${GTK_PLUGIN}"
fi

APPIMAGE_OUTPUT="${ROOT}/EBP.AppImage"
rm -f "${APPIMAGE_OUTPUT}"
echo "Building Linux AppImage through Tauri bundle pipeline…"
npm run build -- --bundles appimage

BUILT_APPIMAGE="$(find "${APPIMAGE_DIR}" -maxdepth 1 -type f -name '*.AppImage' | sort | tail -n 1 || true)"
if [ -n "${BUILT_APPIMAGE}" ]; then
  cp -f "${BUILT_APPIMAGE}" "${APPIMAGE_OUTPUT}"
fi

if [ -f "${APPIMAGE_OUTPUT}" ]; then
  chmod +x "${APPIMAGE_OUTPUT}"
  echo ""
  echo "=== AppImage built successfully ==="
  echo "  ${APPIMAGE_OUTPUT}"
else
  echo "ERROR: AppImage was not produced at ${APPIMAGE_OUTPUT}"
  exit 1
fi
