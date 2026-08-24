#!/usr/bin/env bash
# Android Maestro E2E runner: start isolated key server, clear app data, run flows.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_ID="${MOBILE_E2E_APP_ID:-com.mobile}"
SERVER_PORT="${MOBILE_E2E_SERVER_PORT:-8788}"
SERVER_HEALTH="http://localhost:${SERVER_PORT}/api/v1/health"
DB_PATH="${MOBILE_E2E_DB_PATH:-${ROOT}/test-results/mobile-e2e-server.sqlite}"
RESULTS_DIR="${ROOT}/test-results"
SERVER_LOG="${RESULTS_DIR}/mobile-e2e-server.log"
METRO_LOG="${RESULTS_DIR}/mobile-e2e-metro.log"
SERVER_PID=""
METRO_PID=""

mkdir -p "$RESULTS_DIR"
rm -f "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"

cleanup() {
  if [[ -n "${SERVER_PID}" ]] && kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "[mobile-e2e] Stopping key server (pid ${SERVER_PID})..."
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${METRO_PID}" ]] && kill -0 "${METRO_PID}" 2>/dev/null; then
    echo "[mobile-e2e] Stopping Metro (pid ${METRO_PID})..."
    kill "${METRO_PID}" 2>/dev/null || true
    wait "${METRO_PID}" 2>/dev/null || true
  fi
  adb reverse --remove "tcp:${SERVER_PORT}" >/dev/null 2>&1 || true
  # Keep tcp:8081 reverse so an already-running Metro session stays reachable.
}
trap cleanup EXIT

if ! command -v adb >/dev/null 2>&1; then
  echo "ERROR: adb not found. Install Android platform-tools and ensure adb is on PATH."
  exit 1
fi

# Maestro installer puts the binary in ~/.maestro/bin
export PATH="${PATH}:${HOME}/.maestro/bin"

if ! command -v maestro >/dev/null 2>&1; then
  echo "ERROR: maestro not found. Install from https://maestro.mobile.dev (e.g. curl -Ls \"https://get.maestro.mobile.dev\" | bash)"
  exit 1
fi

ADB_STATE="$(adb get-state 2>/dev/null || true)"
if [[ "${ADB_STATE}" != "device" ]]; then
  echo "ERROR: No Android device/emulator connected (adb get-state=${ADB_STATE:-none})."
  if [[ "${ADB_STATE}" == "unauthorized" ]]; then
    echo "Unlock the phone and accept the 'Allow USB debugging?' prompt, then retry."
  else
    echo "Start an emulator or attach a device, then retry."
  fi
  exit 1
fi

DEVICE_LINE="$(adb devices -l | awk '/\tdevice/{print; exit}')"
IS_EMULATOR=0
if echo "${DEVICE_LINE}" | grep -q "emulator"; then
  IS_EMULATOR=1
fi

# Emulator: 10.0.2.2. Physical USB: adb reverse so the phone can use 127.0.0.1.
if [[ -z "${MOBILE_E2E_SERVER_URL:-}" ]]; then
  if [[ "${IS_EMULATOR}" -eq 1 ]]; then
    MOBILE_E2E_SERVER_URL="http://10.0.2.2:${SERVER_PORT}"
  else
    adb reverse "tcp:${SERVER_PORT}" "tcp:${SERVER_PORT}"
    adb reverse tcp:8081 tcp:8081
    MOBILE_E2E_SERVER_URL="http://127.0.0.1:${SERVER_PORT}"
  fi
elif [[ "${IS_EMULATOR}" -eq 0 ]]; then
  adb reverse "tcp:${SERVER_PORT}" "tcp:${SERVER_PORT}" >/dev/null 2>&1 || true
  adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1 || true
fi
echo "[mobile-e2e] App will use server URL ${MOBILE_E2E_SERVER_URL}"

# @db/sqlite's downloaded plugin needs GLIBC >= 2.38; Ubuntu 22.04 is 2.35.
if [[ -z "${DENO_SQLITE_PATH:-}" ]]; then
  for candidate in \
    /usr/lib/x86_64-linux-gnu/libsqlite3.so \
    /usr/lib/x86_64-linux-gnu/libsqlite3.so.0; do
    if [[ -f "${candidate}" ]]; then
      export DENO_SQLITE_PATH="${candidate}"
      echo "[mobile-e2e] Using system SQLite at ${DENO_SQLITE_PATH}"
      break
    fi
  done
fi

echo "[mobile-e2e] Starting key server on :${SERVER_PORT}..."
env \
  PORT="${SERVER_PORT}" \
  DB_PATH="${DB_PATH}" \
  RATE_LIMIT_DISABLED=true \
  DB_TYPE=sqlite \
  deno task server >"${SERVER_LOG}" 2>&1 &
SERVER_PID=$!

echo "[mobile-e2e] Waiting for ${SERVER_HEALTH}..."
READY=0
for _ in $(seq 1 60); do
  if curl -sf "${SERVER_HEALTH}" >/dev/null 2>&1; then
    READY=1
    break
  fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then
    echo "ERROR: Key server exited early. Log:"
    tail -n 80 "${SERVER_LOG}" || true
    exit 1
  fi
  sleep 0.5
done

if [[ "${READY}" -ne 1 ]]; then
  echo "ERROR: Timed out waiting for key server. Log:"
  tail -n 80 "${SERVER_LOG}" || true
  exit 1
fi
echo "[mobile-e2e] Key server ready."

# Debug APKs load JS from Metro. Start it unless MOBILE_E2E_SKIP_METRO=1.
if [[ "${MOBILE_E2E_SKIP_METRO:-0}" != "1" ]]; then
  if curl -sf "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
    echo "[mobile-e2e] Reusing existing Metro on :8081."
  else
    echo "[mobile-e2e] Starting Metro..."
    (
      cd "${ROOT}/mobile"
      npx react-native start --port 8081
    ) >"${METRO_LOG}" 2>&1 &
    METRO_PID=$!
    METRO_READY=0
    for _ in $(seq 1 60); do
      if curl -sf "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
        METRO_READY=1
        break
      fi
      if ! kill -0 "${METRO_PID}" 2>/dev/null; then
        echo "ERROR: Metro exited early. Log:"
        tail -n 80 "${METRO_LOG}" || true
        exit 1
      fi
      sleep 0.5
    done
    if [[ "${METRO_READY}" -ne 1 ]]; then
      echo "ERROR: Timed out waiting for Metro. Log:"
      tail -n 80 "${METRO_LOG}" || true
      exit 1
    fi
    echo "[mobile-e2e] Metro ready."
  fi
fi

APK_PATH="${MOBILE_E2E_APK:-}"
if [[ -z "${APK_PATH}" ]]; then
  CANDIDATE="${ROOT}/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
  if [[ -f "${CANDIDATE}" ]]; then
    APK_PATH="${CANDIDATE}"
  fi
fi

if [[ -n "${APK_PATH}" ]]; then
  echo "[mobile-e2e] Installing ${APK_PATH}..."
  adb install -r "${APK_PATH}"
elif adb shell pm path "${APP_ID}" >/dev/null 2>&1; then
  echo "[mobile-e2e] Using already-installed ${APP_ID}."
else
  echo "ERROR: ${APP_ID} is not installed and no debug APK was found."
  echo "Build/install once with: (cd mobile && npm run android)"
  echo "Or set MOBILE_E2E_APK=/path/to/app-debug.apk"
  exit 1
fi

echo "[mobile-e2e] Clearing app data for ${APP_ID}..."
adb shell pm clear "${APP_ID}" >/dev/null

FLOW_ARGS=("$@")
if [[ ${#FLOW_ARGS[@]} -eq 0 ]]; then
  # Do not pass the e2e directory: helpers/*.yaml are subflows only.
  FLOW_ARGS=(
    "${ROOT}/mobile/e2e/smoke.yaml"
    "${ROOT}/mobile/e2e/identity.yaml"
    "${ROOT}/mobile/e2e/details.yaml"
    "${ROOT}/mobile/e2e/contacts-lifecycle.yaml"
    "${ROOT}/mobile/e2e/sign-verify.yaml"
    "${ROOT}/mobile/e2e/hierarchy.yaml"
  )
fi

echo "[mobile-e2e] Running Maestro: maestro test -e SERVER_URL=${MOBILE_E2E_SERVER_URL} ${FLOW_ARGS[*]}"
maestro test -e "SERVER_URL=${MOBILE_E2E_SERVER_URL}" "${FLOW_ARGS[@]}"
echo "[mobile-e2e] Done."
