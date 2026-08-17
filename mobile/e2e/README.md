# Mobile Maestro E2E

Android-first end-to-end tests for the React Native app, mirroring the GUI
Playwright harness (isolated key server on `:8788`).

## Prerequisites

1. **Android emulator or device** with `adb` on `PATH` (`adb devices` shows a device).
   For a physical phone: unlock it and accept **Allow USB debugging?** when prompted
   (`adb devices` must show `device`, not `unauthorized`).
2. **Maestro CLI** — https://maestro.mobile.dev  
   Example: `curl -Ls "https://get.maestro.mobile.dev" | bash`
3. **Deno** (repo root) for `deno task server` / `deno task test:e2e:mobile*`.
4. **App installed** — either:
   - `cd mobile && npm run android` once, or
   - set `MOBILE_E2E_APK` to a debug APK path, or
   - rely on `mobile/android/app/build/outputs/apk/debug/app-debug.apk` if already built.

On a **physical phone**, the runner auto-detects USB reverse and passes
`SERVER_URL=http://127.0.0.1:8788` to Maestro (emulator still uses `10.0.2.2`).
Keep `adb reverse tcp:8081 tcp:8081` so the debug app can reach Metro.

## Commands

From the repo root:

```bash
# Full suite (smoke + identity + hierarchy)
deno task test:e2e:mobile

# Smoke only
deno task test:e2e:mobile:smoke

# Single flow
./scripts/mobile-e2e.sh ./mobile/e2e/identity.yaml
```

Do not run `maestro test mobile/e2e` on the whole directory: `helpers/`
contains subflows only. The runner passes the three top-level YAML files
explicitly.

The runner:

1. Starts the key server on `http://localhost:8788` with a throwaway SQLite DB
   under `test-results/mobile-e2e-server.sqlite` and `RATE_LIMIT_DISABLED=true`.
2. Installs the debug APK when found.
3. Runs `adb shell pm clear com.mobile`.
4. Executes Maestro against the given flow(s).

The app must use the emulator loopback URL `http://10.0.2.2:8788` (or
`http://127.0.0.1:8788` on a USB phone with `adb reverse`) — passed by the
runner as Maestro `-e SERVER_URL=…`. Password for created identities:
`Smoke-test-password1` (same as GUI Playwright).

## Flows

| File | Coverage |
|------|----------|
| `smoke.yaml` | Launch, Identities tab, More → Settings |
| `identity.yaml` | HD create, set server, publish |
| `hierarchy.yaml` | Two identities, propose/accept, Load Tree |
| `helpers/` | Shared subflows (create HD identity, set server) |

## testIDs

Stable selectors live on shared components (`AppButton`, `TextField`, …) and
critical screens. Maestro targets them with `id: …` (React Native `testID`).
