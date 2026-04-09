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
npm install

# Build the Rust binary directly with cargo since the tauri CLI may crash on
# older Node.js.  option_env!() reads MAIL_OAUTH_*_CLIENT_ID at compile time,
# so these env vars (loaded from .env.desktop.build above) must be present.
echo "Building Tauri Rust binary (cargo build --release)…"
cd "${ROOT}/desktop/src-tauri"
cargo build --release --features custom-protocol

cd "${ROOT}/desktop"
# tauri build generates the AppImage bundle scripts/scaffolding.
# Allow it to fail – cargo already built the binary above, and the AppImage
# bundling step often fails due to a symlink bug in the gtk plugin anyway.
npm run build || echo "tauri build exited non-zero (expected); continuing manually…"

if [ ! -f "${APPIMAGE_DIR}/build_appimage.sh" ]; then
  echo "ERROR: build_appimage.sh not found – tauri build may have failed before generating bundle scripts."
  exit 1
fi

# Patch the cached gtk plugin so 'ln -s' becomes 'ln -sf' (avoids "File exists" errors).
GTK_PLUGIN="${HOME}/.cache/tauri/linuxdeploy-plugin-gtk.sh"
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
case "$(uname -m)" in
  x86_64)
    SIDECAR_TRIPLE="x86_64-unknown-linux-gnu"
    ;;
  aarch64|arm64)
    SIDECAR_TRIPLE="aarch64-unknown-linux-gnu"
    ;;
  *)
    echo "ERROR: Unsupported Linux architecture: $(uname -m)"
    exit 1
    ;;
esac
ORIGINAL_BACKEND="${ROOT}/desktop/src-tauri/bin/ebp-gui-backend-${SIDECAR_TRIPLE}"

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
APPIMAGETOOL="${HOME}/.cache/tauri/appimagetool-x86_64.AppImage"
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
