# Mobile Maestro E2E

Android-first end-to-end tests for the React Native app, mirroring the GUI
Playwright harness (isolated key server on `:8788`).

## Prerequisites

1. **Android emulator or device** with `adb` on `PATH` (`adb devices` shows a device).
   For a physical phone: unlock it and accept **Allow USB debugging?** when prompted
   (`adb devices` must show `device`, not `unauthorized`). Keep the screen awake:
   `adb shell svc power stayon usb`.
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
# Full suite (smoke + identity + details + contacts-lifecycle + sign-verify + hierarchy)
deno task test:e2e:mobile

# Smoke only
deno task test:e2e:mobile:smoke

# Smoke + identity (skip details / sign-verify / hierarchy)
deno task test:e2e:mobile:fast

# Single flow
./scripts/mobile-e2e.sh ./mobile/e2e/identity.yaml
```

Do not run `maestro test mobile/e2e` on the whole directory: `helpers/`
contains subflows only. The runner passes the top-level YAML files
explicitly.

If Metro is already running on `:8081`:

```bash
MOBILE_E2E_SKIP_METRO=1 deno task test:e2e:mobile
```

On Ubuntu 22.04 the runner sets `DENO_SQLITE_PATH` to the system
`libsqlite3.so` so Deno's SQLite plug is not blocked by GLIBC.

The runner:

1. Starts the key server on `http://localhost:8788` with a throwaway SQLite DB
   under `test-results/mobile-e2e-server.sqlite` and `RATE_LIMIT_DISABLED=true`.
2. Installs the debug APK when found.
3. Runs `adb shell pm clear com.mobile`.
4. Executes Maestro against the given flow(s).

The app must use `http://10.0.2.2:8788` on an emulator, or
`http://127.0.0.1:8788` on a USB phone with `adb reverse` — passed by the
runner as Maestro `-e SERVER_URL=…`. Password for created identities:
`Smoke-test-password1` (same as GUI Playwright).

### Helper `env:` pitfall

Maestro helper `env:` overwrites parent / CLI `-e` values. Do not put
`SERVER_URL` or `IDENTITY_NAME` defaults in helper YAML. Pass them only via
`runFlow` `env:`.

### Autofill

Android may show **Use your saved password for EBP?** over the password
modal. Flows that type into `password-modal-input` should run
`helpers/dismiss-autofill.yaml` first (taps **No thanks** if present).

## Flows

| File | Coverage |
|------|----------|
| `smoke.yaml` | Launch, Identities tab, More (About, Mail trace, Diagnostics, core self-test, Activity log, Settings toggles) |
| `identity.yaml` | HD create, set server, wrong-password publish, successful publish |
| `details.yaml` | HD create + publish, push email detail, Contacts browse/search |
| `contacts-lifecycle.yaml` | HD create + publish, export public JSON, emergency cert, fetch contact, local notes, delete contact + identity |
| `sign-verify.yaml` | Sign attached message, paste payload, verify |
| `hierarchy.yaml` | Two identities, propose/accept, Load Tree |
| `helpers/` | Shared subflows (create HD identity, set server, dismiss autofill) |

Default suite order puts details and sign-verify **before** hierarchy so a
details failure fails faster than the long HD keygen. `contacts-lifecycle`
runs after details (needs publish + server fetch).

On Ubuntu 22.04, start Metro with **Node 22+** (`nvm use 22`) if system Node
is too old for React Native 0.84, then:
`MOBILE_E2E_SKIP_METRO=1 deno task test:e2e:mobile`.

## testIDs

Stable selectors live on shared components (`AppButton`, `TextField`, …) and
critical screens. Maestro targets them with `id: …` (React Native `testID`).
Sign/verify copies the signed JSON to the clipboard on sign, then uses
Paste on Verify (`pasteText` cannot type ML-DSA JSON). After “Message signed”,
do **not** `hideKeyboard` (that sends Android Back and leaves Sign Message).
Use one `back` to return to the Crypto hub. Do not tap Copy: on some phones
it opens system Quick Share.
