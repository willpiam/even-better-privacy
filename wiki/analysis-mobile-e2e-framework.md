---
title: "Mobile E2E Framework"
type: analysis
status: active
last_updated: 2026-08-24
source_count: 8
tags:
  - analysis
  - mobile
  - testing
  - e2e
  - gui
  - maestro
---

# Mobile E2E Framework

Android Maestro harness for [[component-mobile]], mirroring the GUI Playwright
role (`gui/e2e/`, `playwright.config.ts`) without cross-client GUI↔mobile
coverage (see [[analysis-hierarchy-gui-e2e-coverage]]).

## Current state

| Surface | E2E | Notes |
|---------|-----|--------|
| [[component-gui]] | Playwright | Specs under `gui/e2e/` (smoke, identity, hierarchy, mail); `deno task test:e2e` |
| [[component-mobile]] | Maestro (Android) | Flows under `mobile/e2e/`; `deno task test:e2e:mobile` |
| Shared | Partial | `test/mobile-parity_test.ts`, interop fixtures — not UI or device flows |

## Harness

- **Driver:** Maestro YAML (`mobile/e2e/`).
- **Runner:** [`scripts/mobile-e2e.sh`](../scripts/mobile-e2e.sh) — starts key
  server on `:8788` with throwaway SQLite
  (`test-results/mobile-e2e-server.sqlite`), `RATE_LIMIT_DISABLED=true`,
  requires `adb` device, `adb shell pm clear com.mobile`, then `maestro test`.
- **Physical phone (USB):** runner runs `adb reverse` for Metro (`8081`) and
  the key server (`8788`), then passes
  `SERVER_URL=http://127.0.0.1:8788`. Do not hardcode `10.0.2.2` for USB.
- **Emulator:** `SERVER_URL=http://10.0.2.2:8788`.
- **Ubuntu 22.04 / GLIBC:** Deno's bundled `@db/sqlite` can fail on older
  GLIBC; set `DENO_SQLITE_PATH` to the system lib
  (`/usr/lib/x86_64-linux-gnu/libsqlite3.so`). The runner sets this when the
  file exists.
- **Reuse Metro:** `MOBILE_E2E_SKIP_METRO=1` when `npx react-native start` is
  already on `:8081`.
- **Tasks:** `deno task test:e2e:mobile` (full suite),
  `test:e2e:mobile:smoke`, `test:e2e:mobile:fast` (smoke + identity).
- **Password:** `Smoke-test-password1` (same as GUI).
- **Docs:** `mobile/e2e/README.md`.

### Helper env pitfall

Maestro helper `env:` **overwrites** parent/`-e` variables. Do **not** put
`SERVER_URL` or `IDENTITY_NAME` defaults in helper YAML. Pass them only via
`runFlow` `env:` (and runner `-e SERVER_URL=…`).

### Autofill

Android may show **Use your saved password for EBP?** over `PasswordModal`.
Tap **No thanks** via `helpers/dismiss-autofill.yaml` before typing into
`password-modal-input`.

### hideKeyboard vs Back

`hideKeyboard` sends Android Back when no IME is showing, which pops the
current screen. After Sign Message succeeds, do **not** hideKeyboard; use
one `back` to return to the Crypto hub. Tapping Copy can open OEM Quick
Share; sign copies the payload to the clipboard automatically.

### Sign/verify verify path

Verify uses the identity embedded in the signed payload when present
(no local contact required). Maestro waits for **Pasted payload** rather
than scanning the huge JSON EditText.

### Isolation

Each flow starts with `launchApp: clearState: true` (or
`helpers/clear-and-launch.yaml`). The runner also `pm clear`s once at suite
start. The key-server SQLite is shared for the whole suite run.

Default runner must list **explicit YAML files**, never `mobile/e2e/` as a
directory (`helpers/` are subflows, not tests).

## Flows

| Flow | Coverage |
|------|----------|
| `mobile/e2e/smoke.yaml` | Launch, Identities tab, More → Settings |
| `mobile/e2e/identity.yaml` | HD create, set server, wrong-password publish, successful publish |
| `mobile/e2e/details.yaml` | HD create + publish, push detail, Contacts browse/search |
| `mobile/e2e/sign-verify.yaml` | Sign attached message, paste payload, verify |
| `mobile/e2e/hierarchy.yaml` | Two HD identities, propose/accept, Load Tree |
| `mobile/e2e/helpers/*` | clear-and-launch, set-server, create-hd-identity, dismiss-autofill |

Identity creation is **HD-only** via `HdCreateScreen` (Generate mnemonic
auto-fills confirm for the in-app generate path).

Default suite order: smoke → identity → details → sign-verify → hierarchy
(details/sign-verify fail before the ~4m HD hierarchy keygen).

## App instrumentation

Stable `testID`s on `AppButton`, `TextField`, `PasswordModal`, `ListRow`,
`ContactPicker`, `Card`, `StatusBanner`, tab bar (`tabBarButtonTestID`),
Identities / Settings / Certificates, Identity details, Crypto hub,
Sign/Verify, and Contacts fetch/browse. Maestro targets `id: …`.
Sign/verify copies the signed JSON to the clipboard on sign, then Paste
on Verify (`pasteText` cannot type ML-DSA JSON). Verify reads embedded
`identity` from the payload when no contact exists.

## Still out of scope

- GUI↔mobile propose/accept interop E2E
- Mail E2E on device
- GUI revoke-identity / tamper / wrong-sender / browse-trust on mobile
- iOS Maestro / CI emulator job
- In-app factory wipe (adb clear is the isolation mechanism)

## Related

- [[component-mobile]]
- [[component-gui]]
- [[component-server]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-mobile-standalone-install]]
- [[analysis-mobile-certificates-ux]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-testing-and-gui-gaps]]

## Sources

- `scripts/mobile-e2e.sh`
- `mobile/e2e/` (smoke, identity, details, sign-verify, hierarchy, helpers, README)
- `deno.json` (`test:e2e:mobile`, `test:e2e:mobile:smoke`, `test:e2e:mobile:fast`)
- `playwright.config.ts`
- `gui/e2e/hierarchy.spec.ts`
- `gui/e2e/identity.spec.ts`
- [[analysis-hierarchy-gui-e2e-coverage]]
