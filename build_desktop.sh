#!/usr/bin/env bash
set -euo pipefail

echo "Prereqs (once): sudo apt install libwebkit2gtk-4.0-dev libssl-dev build-essential"

ROOT="/home/william/projects/even-better-privacy"
APPIMAGE_DIR="${ROOT}/desktop/src-tauri/target/release/bundle/appimage"

rm -rf "${APPIMAGE_DIR}/ebp.AppDir"

cd "${ROOT}/desktop"
npm install

if npm run build; then
  echo "AppImage output:"
  echo "${APPIMAGE_DIR}"
  exit 0
fi

if [ -f "${APPIMAGE_DIR}/build_appimage.sh" ]; then
  output_name=$(grep -o 'OUTPUT="[^"]*"' "${APPIMAGE_DIR}/build_appimage.sh" | head -1 | cut -d'"' -f2)
  sed -i "s|--appdir \"ebp.AppDir\"|--appdir \"${APPIMAGE_DIR}/ebp.AppDir\"|" "${APPIMAGE_DIR}/build_appimage.sh"
  if [ -n "${output_name}" ]; then
    output_basename=$(basename "${output_name}")
    sed -i "s|OUTPUT=\"${output_name}\"|OUTPUT=\"${output_basename}\"|" "${APPIMAGE_DIR}/build_appimage.sh"
  fi
  (cd "${APPIMAGE_DIR}" && rm -rf ebp.AppDir && bash build_appimage.sh)
  echo "AppImage output:"
  echo "${APPIMAGE_DIR}"
  exit 0
fi

echo "AppImage build script not found in ${APPIMAGE_DIR}"
exit 1