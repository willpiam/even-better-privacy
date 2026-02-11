#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="${ROOT}/email/chrome-extension"
KEY_FILE="${ROOT}/email/chrome-extension.pem"
CRX_FILE="${ROOT}/email/chrome-extension.crx"

if [[ ! -f "${EXT_DIR}/manifest.json" ]]; then
  echo "ERROR: ${EXT_DIR}/manifest.json not found."
  exit 1
fi

PACKER=""
for candidate in chromium chromium-browser google-chrome-stable google-chrome; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    PACKER="${candidate}"
    break
  fi
done

if [[ -z "${PACKER}" ]]; then
  echo "ERROR: Could not find Chromium/Chrome executable."
  echo "Install one of: chromium, chromium-browser, google-chrome-stable, google-chrome"
  exit 1
fi

echo "Using ${PACKER} to pack extension..."

if [[ -f "${KEY_FILE}" ]]; then
  "${PACKER}" \
    --pack-extension="${EXT_DIR}" \
    --pack-extension-key="${KEY_FILE}"
else
  "${PACKER}" --pack-extension="${EXT_DIR}"
fi

if [[ -f "${CRX_FILE}" ]]; then
  echo ""
  echo "CRX build complete:"
  echo "  ${CRX_FILE}"
  if [[ -f "${KEY_FILE}" ]]; then
    echo "Key reused:"
    echo "  ${KEY_FILE}"
  else
    echo "Key created:"
    echo "  ${KEY_FILE}"
    echo "Keep this file safe to preserve the extension ID across releases."
  fi
else
  echo "ERROR: ${CRX_FILE} was not produced."
  exit 1
fi
