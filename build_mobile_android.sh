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
#   - The Cursor command sandbox points GRADLE_USER_HOME at
#     /tmp/cursor-sandbox-cache. This script pins it back to ~/.gradle so a
#     second daemon does not OOM-kill Cursor. See
#     wiki/analysis-mobile-android-build-oom.md.
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

# Cursor's command sandbox sets GRADLE_USER_HOME under /tmp/cursor-sandbox-cache.
# That starts a second multi-GB daemon. Combined with a leftover daemon from a
# previous crash, that fills 16GB RAM and the kernel kills Cursor
# (oom_score_adj=300) before adb install runs. ~/.gradle itself is not
# redirected, so pin the real cache and reuse its daemon.
if [[ "${GRADLE_USER_HOME:-}" == *cursor-sandbox-cache* ]] || [[ -n "${__CURSOR_SANDBOX_ENV_RESTORE:-}" ]] || [[ "${GOCACHE:-}${NPM_CONFIG_CACHE:-}" == *cursor-sandbox-cache* ]]; then
  echo "Cursor sandbox detected; pinning GRADLE_USER_HOME to ${HOME}/.gradle"
  export GRADLE_USER_HOME="${HOME}/.gradle"
fi

MEM_AVAIL_KB="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)"
if [[ "${MEM_AVAIL_KB}" -lt 4000000 ]]; then
  die "only $((MEM_AVAIL_KB / 1024)) MiB available. Stop leftover sandbox Gradle daemons (cwd under /tmp/cursor-sandbox-cache) before building. See wiki/analysis-mobile-android-build-oom.md"
fi

# React Native's CLI needs Node 22. Prefer the nvm install over an older system node.
# An already-running Gradle daemon does not pick up this PATH, so the absolute
# binary is also passed as -PnodeBinary (see mobile/android/app/build.gradle).
NODE_BINARY=""
if [[ -d "${HOME}/.nvm/versions/node" ]]; then
  NODE22_BIN="$(find "${HOME}/.nvm/versions/node" -maxdepth 2 -type d -name 'v22.*' -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n1 | cut -d' ' -f2-)"
  if [[ -n "${NODE22_BIN}" && -x "${NODE22_BIN}/bin/node" ]]; then
    export PATH="${NODE22_BIN}/bin:${PATH}"
    NODE_BINARY="${NODE22_BIN}/bin/node"
  fi
fi

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
if [[ -n "${NODE_BINARY}" ]]; then
  echo "  node: ${NODE_BINARY} ($("${NODE_BINARY}" -v))"
fi
# Cap workers so native clang jobs do not spike the machine into OOM.
GRADLE_ARGS=(--quiet assembleRelease "-PreactNativeArchitectures=${ARCHES}" -Dorg.gradle.workers.max=2)
if [[ -n "${NODE_BINARY}" ]]; then
  GRADLE_ARGS+=("-PnodeBinary=${NODE_BINARY}")
fi
./gradlew "${GRADLE_ARGS[@]}"

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
