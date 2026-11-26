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
# Full suite (smoke + identity + details + contacts-lifecycle + sign-verify)
deno task test:e2e:mobile

# Smoke only
deno task test:e2e:mobile:smoke

# Smoke + identity (skip details / sign-verify)
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
   under `test-results/mobile-e2e/server.sqlite` and `RATE_LIMIT_DISABLED=true`.
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
| `smoke.yaml` | Launch, Identities tab, More (About, Settings toggles); works with debug and release builds |
| `developer.yaml` | Development build only: mail trace, Argon2/PBKDF2 parity, core self-test |
| `identity.yaml` | HD create, set server, wrong-password publish, successful publish |
| `details.yaml` | HD create + publish, push email detail, Contacts browse/search |
| `contacts-lifecycle.yaml` | HD create + publish, export public JSON, emergency cert, fetch contact, local notes, delete contact + identity |
| `sign-verify.yaml` | Sign attached message, paste payload, verify |
| `helpers/` | Shared subflows (create HD identity, set server, dismiss autofill) |

The identity overview shows server publication and email verification status.
Forms live on the Identity details, Export and backup, and Revocation and removal
screens. `helpers/publish-identity.yaml` opens publication, unlocks the identity,
and returns to the overview after confirming the published indicator.

`contacts-lifecycle` runs after details (needs publish + server fetch).
Hierarchy management is deferred from v1 and has no mobile UI flow.

On Ubuntu 22.04, start Metro with **Node 22+** (`nvm use 22`) if system Node
is too old for React Native 0.84, then:
`MOBILE_E2E_SKIP_METRO=1 deno task test:e2e:mobile`.

## Background process-death regression (Android)

Run this check on an installed standalone release APK. It reproduces Android
reclaiming an idle app while retaining its task, without waiting for memory
pressure. Ordinary `launchApp` / force-stop tests do not exercise this path.

1. Open EBP and navigate to **More → Settings** so native navigation fragments
   exist. Note an existing identity or setting to check afterward.
2. Press Home and wait for EBP to finish moving to the background. Keep its task
   in Recents; do not swipe it away.
3. Kill only its background process, then check that it is gone:

   ```bash
   adb shell am kill com.mobile
   adb shell pidof com.mobile
   ```

   `pidof` must print nothing (a nonzero exit is expected). If it still prints a
   PID, ensure EBP is in the background, wait briefly, and repeat this step.
4. Open EBP **once** from its launcher icon, or use the equivalent intent:

   ```bash
   adb shell am start -W -a android.intent.action.MAIN \
     -c android.intent.category.LAUNCHER -n com.mobile/.MainActivity
   ```

5. Verify that EBP stays open on the first attempt, its tabs work, and the saved
   identity/settings remain. Repeat from another tab and from a nested screen.
   A new process starts a new unlock session and may return to the initial tab.

In a minified release, R8 can rename the screen fragments. The previous
restoration factory checked for the original package name, so Android could
still try to construct a saved fragment and crash with `Screen fragments should
never be restored` or `ScreenStack fragments should never be restored`. Inspect
`adb logcat -b crash -d` for new entries from `com.mobile` after the test.

`MainActivity.onCreate` passes `null` to `super.onCreate` so React Navigation
can rebuild its screens without restoring stale native fragments. After
installing dependencies, rebuild and install the release APK with
`./build_mobile_android.sh --skip-npm --install` to exercise this change.

## Development tools

Release builds omit Developer, Diagnostics, Mail trace, and the test-address toggle.
Run `./scripts/mobile-e2e.sh ./mobile/e2e/developer.yaml` explicitly against a
development build after native crypto changes. Normal `smoke.yaml` has no
dependency on developer controls. Mail tracing is off by default; enable
**Record mail trace** before reproducing a problem. Traces are bounded and
memory-only, and disappear when the app process ends.

## testIDs

Stable selectors live on shared components (`AppButton`, `TextField`, …) and
critical screens. Maestro targets them with `id: …` (React Native `testID`).
Sign/verify copies the signed JSON to the clipboard on sign, then uses
Paste on Verify (`pasteText` cannot type ML-DSA JSON). After “Message signed”,
do **not** `hideKeyboard` (that sends Android Back and leaves Sign Message).
Use one `back` to return to the Crypto hub. Do not tap Copy: on some phones
it opens system Quick Share.
