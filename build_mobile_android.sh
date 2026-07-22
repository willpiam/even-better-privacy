#!/usr/bin/env bash
# Build a standalone Android release APK for EBP mobile (JS bundle embedded).
# After install, the app should keep working with Metro stopped / USB unplugged.
#
# Usage:
#   ./build_mobile_android.sh              # build APK only
#   ./build_mobile_android.sh --install    # build + adb install -r
#   ./build_mobile_android.sh --skip-npm   # skip npm install
#   ./build_mobile_android.sh --arch arm64-v8a
#
# Notes:
#   - Release is currently signed with the Android *debug* keystore (dev-only).
#   - Default ABI is arm64-v8a (typical phones). Override with --arch if needed.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="${ROOT}/mobile"
ANDROID_DIR="${MOBILE_DIR}/android"
OUT_DIR="${ROOT}/dist/mobile"
APK_NAME="ebp-mobile-release.apk"

DO_INSTALL=0
SKIP_NPM=0
# Phone-oriented default; override with --arch (comma-separated RN arches)
ARCHES="arm64-v8a"

usage() {
  cat <<'EOF'
Build a standalone Android release APK for EBP mobile (JS bundle embedded).
After install, the app should keep working with Metro stopped / USB unplugged.

Usage:
  ./build_mobile_android.sh              # build APK only
  ./build_mobile_android.sh --install    # build + adb install -r
  ./build_mobile_android.sh --skip-npm   # skip npm install
  ./build_mobile_android.sh --arch arm64-v8a

Notes:
  - Release is currently signed with the Android *debug* keystore (dev-only).
  - Default ABI is arm64-v8a (typical phones). Override with --arch if needed.
EOF
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    -i|--install) DO_INSTALL=1; shift ;;
    --skip-npm) SKIP_NPM=1; shift ;;
    --arch)
      [[ $# -ge 2 ]] || { echo "ERROR: --arch needs a value (e.g. arm64-v8a)"; exit 1; }
      ARCHES="$2"
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument: $1"
      usage 1
      ;;
  esac
done

die() { echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null || die "node not found"
command -v npm >/dev/null || die "npm not found"
[[ -x "${ANDROID_DIR}/gradlew" ]] || die "missing ${ANDROID_DIR}/gradlew"

# Prefer ANDROID_HOME / ANDROID_SDK_ROOT; else sdk.dir from local.properties
if [[ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]]; then
  if [[ -f "${ANDROID_DIR}/local.properties" ]]; then
    SDK_DIR="$(sed -n 's/^sdk\.dir=//p' "${ANDROID_DIR}/local.properties" | head -n1 | sed 's/\\\\/\//g')"
    if [[ -n "${SDK_DIR}" && -d "${SDK_DIR}" ]]; then
      export ANDROID_HOME="${SDK_DIR}"
      export ANDROID_SDK_ROOT="${SDK_DIR}"
      echo "Using Android SDK from local.properties: ${SDK_DIR}"
    fi
  fi
fi
[[ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]] || die "ANDROID_HOME / ANDROID_SDK_ROOT not set (and no sdk.dir in local.properties)"

echo "=== EBP mobile Android release build ==="
echo "  arches: ${ARCHES}"
echo "  install: ${DO_INSTALL}"
echo ""

cd "${MOBILE_DIR}"

if [[ "${SKIP_NPM}" -eq 0 ]]; then
  echo "Installing npm dependencies…"
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  echo "Skipping npm install (--skip-npm)"
  [[ -d node_modules ]] || die "node_modules missing; run without --skip-npm"
fi

cd "${ANDROID_DIR}"
echo "Building assembleRelease (embeds JS bundle; no Metro required at runtime)…"
./gradlew --quiet assembleRelease "-PreactNativeArchitectures=${ARCHES}"

BUILT_APK="$(find "${ANDROID_DIR}/app/build/outputs/apk/release" -maxdepth 1 -type f -name '*.apk' | sort | tail -n 1 || true)"
[[ -n "${BUILT_APK}" && -f "${BUILT_APK}" ]] || die "release APK not found under app/build/outputs/apk/release"

mkdir -p "${OUT_DIR}"
OUT_APK="${OUT_DIR}/${APK_NAME}"
cp -f "${BUILT_APK}" "${OUT_APK}"

echo ""
echo "=== Release APK ready ==="
echo "  ${OUT_APK}"
echo "  (signed with debug keystore — fine for personal sideload, not for store distribution)"
echo ""

if [[ "${DO_INSTALL}" -eq 1 ]]; then
  command -v adb >/dev/null || die "adb not found (needed for --install)"
  adb start-server >/dev/null
  DEVICE_COUNT="$(adb devices | awk 'NR>1 && $2=="device" {c++} END {print c+0}')"
  [[ "${DEVICE_COUNT}" -ge 1 ]] || die "no device in 'adb devices' state 'device' (enable USB debugging / authorize)"
  echo "Installing on device (adb install -r)…"
  adb install -r "${OUT_APK}"
  echo ""
  echo "Installed. You can unplug USB and stop Metro; the app should still launch."
  echo "Launch: open the EBP / mobile app icon, or: adb shell am start -n com.mobile/.MainActivity"
else
  echo "To install on a connected phone:"
  echo "  adb install -r ${OUT_APK}"
  echo "  # or re-run: ./build_mobile_android.sh --install --skip-npm"
fi
