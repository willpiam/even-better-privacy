#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${ROOT}/desktop"
BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle/dmg"
APP_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle/macos"
DMG_OUTPUT="${ROOT}/EBP.dmg"
APP_OUTPUT_DIR="${ROOT}/EBP.app"

echo "Building EBP desktop app for macOS (DMG)..."
echo "Note: this script must run on macOS unless you have a full cross-compilation setup."

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ERROR: macOS build requested, but host OS is $(uname -s)."
  echo "Run this on macOS, or configure cross-compilation first."
  exit 1
fi

cd "${DESKTOP_DIR}"
npm install

# Override tauri.conf bundle target and build mac artifacts.
npm run build -- --bundles dmg

LATEST_DMG="$(find "${BUNDLE_DIR}" -maxdepth 1 -type f -name "*.dmg" | sort | tail -n 1 || true)"
if [ -z "${LATEST_DMG}" ]; then
  echo "ERROR: No DMG produced in ${BUNDLE_DIR}"
  exit 1
fi

cp -f "${LATEST_DMG}" "${DMG_OUTPUT}"

# Optionally copy the .app bundle if Tauri produced one.
LATEST_APP="$(find "${APP_DIR}" -maxdepth 1 -type d -name "*.app" | sort | tail -n 1 || true)"
if [ -n "${LATEST_APP}" ]; then
  rm -rf "${APP_OUTPUT_DIR}"
  cp -R "${LATEST_APP}" "${APP_OUTPUT_DIR}"
fi

echo ""
echo "=== macOS build completed ==="
echo "  DMG: ${DMG_OUTPUT}"
if [ -d "${APP_OUTPUT_DIR}" ]; then
  echo "  APP: ${APP_OUTPUT_DIR}"
fi
