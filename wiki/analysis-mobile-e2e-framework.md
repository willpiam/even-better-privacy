---
title: "Mobile E2E Framework"
type: analysis
status: active
last_updated: 2026-08-10
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
- **Tasks:** `deno task test:e2e:mobile`, `deno task test:e2e:mobile:smoke`.
- **App server URL in flows:** `http://10.0.2.2:8788` (emulator → host).
- **Password:** `Smoke-test-password1` (same as GUI).
- **Docs:** `mobile/e2e/README.md`.

## Flows

| Flow | Coverage |
|------|----------|
| `mobile/e2e/smoke.yaml` | Launch, Identities tab, More → Settings |
| `mobile/e2e/identity.yaml` | HD create, set server, publish |
| `mobile/e2e/hierarchy.yaml` | Two HD identities, propose/accept, Load Tree |
| `mobile/e2e/helpers/*` | clear-and-launch, set-server, create-hd-identity |

Identity creation is **HD-only** via `HdCreateScreen` (Generate mnemonic
auto-fills confirm for the in-app generate path).

## App instrumentation

Stable `testID`s on `AppButton`, `TextField`, `PasswordModal`, `ListRow`,
`ContactPicker`, `Card`, `StatusBanner`, tab bar (`tabBarButtonTestID`), and
critical Identities / Settings / Certificates controls. Maestro targets
`id: …`.

## Still out of scope

- GUI↔mobile propose/accept interop E2E
- Mail E2E on device
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

## Sources

- `scripts/mobile-e2e.sh`
- `mobile/e2e/` (smoke, identity, hierarchy, helpers, README)
- `deno.json` (`test:e2e:mobile`, `test:e2e:mobile:smoke`)
- `playwright.config.ts`
- `gui/e2e/hierarchy.spec.ts`
- [[analysis-hierarchy-gui-e2e-coverage]]
