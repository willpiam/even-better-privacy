#!/usr/bin/env bash
set -euo pipefail

echo "Prereqs (once): sudo apt install libwebkit2gtk-4.0-dev libssl-dev build-essential"

ROOT="/home/william/projects/even-better-privacy"
APPIMAGE_DIR="${ROOT}/desktop/src-tauri/target/release/bundle/appimage"

rm -rf "${APPIMAGE_DIR}/ebp.AppDir"

cd "${ROOT}/desktop"
npm install

# tauri build compiles the binary and generates bundle scripts, but the
# AppImage bundling step often fails due to a symlink bug in the gtk plugin.
# Allow it to fail – we'll run the AppImage build ourselves afterwards.
npm run build || echo "tauri build exited non-zero (expected – AppImage bundling issue); continuing manually…"

if [ ! -f "${APPIMAGE_DIR}/build_appimage.sh" ]; then
  echo "ERROR: build_appimage.sh not found – tauri build may have failed before generating bundle scripts."
  exit 1
fi

# Patch the cached gtk plugin so 'ln -s' becomes 'ln -sf' (avoids "File exists" errors).
GTK_PLUGIN="/home/william/.cache/tauri/linuxdeploy-plugin-gtk.sh"
if [ -f "${GTK_PLUGIN}" ]; then
  sed -i 's/ln \$verbose -s /ln \$verbose -sf /g' "${GTK_PLUGIN}"
fi

# Patch build_appimage.sh: fix relative appdir path and output name.
cd "${APPIMAGE_DIR}"
sed -i "s|--appdir \"ebp.AppDir\"|--appdir \"${APPIMAGE_DIR}/ebp.AppDir\"|" build_appimage.sh

# Set OUTPUT to an absolute path so the AppImage lands in a known location.
APPIMAGE_OUTPUT="${ROOT}/EBP.AppImage"
sed -i "s|OUTPUT=\"[^\"]*\"|OUTPUT=\"${APPIMAGE_OUTPUT}\"|" build_appimage.sh

# Keep a copy of the original Deno-compiled sidecar binary.
# linuxdeploy's patchelf will corrupt its embedded standalone section,
# so we restore it after deployment but before final AppImage packaging.
ORIGINAL_BACKEND="${ROOT}/desktop/src-tauri/bin/ebp-gui-backend-x86_64-unknown-linux-gnu"

# Clean the AppDir left by the failed tauri build and rebuild from scratch.
rm -rf ebp.AppDir
bash build_appimage.sh

# The AppImage was created, but the sidecar inside is corrupted by patchelf.
# Restore the original binary, then repackage.
echo ""
echo "Restoring original Deno sidecar binary (patchelf corrupts it)…"
cp -f "${ORIGINAL_BACKEND}" "${APPIMAGE_DIR}/ebp.AppDir/usr/bin/ebp-gui-backend"
chmod +x "${APPIMAGE_DIR}/ebp.AppDir/usr/bin/ebp-gui-backend"

# Download appimagetool to repackage the fixed AppDir.
APPIMAGETOOL="/home/william/.cache/tauri/appimagetool-x86_64.AppImage"
if [ ! -f "${APPIMAGETOOL}" ]; then
  echo "Downloading appimagetool…"
  wget -q -4 "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
    -O "${APPIMAGETOOL}"
fi
chmod +x "${APPIMAGETOOL}"

# Repackage the AppDir into a fresh AppImage with the uncorrupted sidecar.
rm -f "${APPIMAGE_OUTPUT}"
ARCH=x86_64 "${APPIMAGETOOL}" --appimage-extract-and-run "${APPIMAGE_DIR}/ebp.AppDir" "${APPIMAGE_OUTPUT}"

if [ -f "${APPIMAGE_OUTPUT}" ]; then
  chmod +x "${APPIMAGE_OUTPUT}"
  echo ""
  echo "=== AppImage built successfully ==="
  echo "  ${APPIMAGE_OUTPUT}"
else
  echo "ERROR: AppImage was not produced at ${APPIMAGE_OUTPUT}"
  exit 1
fi
