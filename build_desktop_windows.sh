#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="${ROOT}/desktop"
BUNDLE_DIR="${DESKTOP_DIR}/src-tauri/target/release/bundle/msi"
MSI_OUTPUT="${ROOT}/EBP.msi"

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

cd "${DESKTOP_DIR}"
npm install

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
