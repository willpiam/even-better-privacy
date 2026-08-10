---
title: "Mobile E2E Framework Plan"
type: analysis
status: active
last_updated: 2026-08-10
source_count: 6
tags:
  - analysis
  - mobile
  - testing
  - e2e
  - gui
---

# Mobile E2E Framework Plan

How to add an end-to-end test framework for [[component-mobile]] that mirrors
the role of GUI Playwright (`gui/e2e/`, `playwright.config.ts`) without claiming
cross-client GUI↔mobile coverage yet (see
[[analysis-hierarchy-gui-e2e-coverage]]).

## Current state

| Surface | E2E | Notes |
|---------|-----|--------|
| [[component-gui]] | Playwright | Specs under `gui/e2e/` (smoke, identity, hierarchy, mail); `deno task test:e2e` |
| [[component-mobile]] | None | Jest unit tests only (`mobile` `npm test`); no Maestro/Detox/Appium |
| Shared | Partial | `test/mobile-parity_test.ts`, interop fixtures — not UI or device flows |

## What “like the GUI” means (patterns to copy)

GUI harness shape (`playwright.config.ts` + `gui/e2e/*`):

1. **Isolated data dirs** — GUI uses `HOME=test-results/e2e-home` and a throwaway
   server DB (`test-results/e2e-server.sqlite`).
2. **Auto-started dependencies** — Playwright `webServer` starts local GUI
   (`:8787`) and [[component-server]] (`:8788`, rate limit disabled).
3. **Optional Postgres** — `deno task test:e2e:psql` / `scripts/e2e-with-postgres.sh`.
4. **Spec ladder** — smoke → identity lifecycle → hierarchy → mail (mail needs
   `.env` credentials).
5. **Real UI helpers** — create/publish/switch identity, password modal, server
   URL, certificates propose/accept — not API-only stubs.
6. **Single-worker, headed-friendly** — `workers: 1`, root tasks
   `test:e2e` / `test:e2e:inspect`.

Mobile should reuse the **same server + isolation model**; only the UI driver
changes.

## Recommended tool: Maestro (primary)

Prefer **Maestro** for React Native device/UI E2E:

- YAML flows under `mobile/e2e/` (parallel to `gui/e2e/`).
- No in-app Detox instrumentation; works with debug or release APK
  ([[analysis-mobile-standalone-install]]).
- Good fit for Android-first CI (EBP already has
  `build_mobile_android.sh` / `android:release:install`).
- Wiki gap already named Maestro first
  ([[analysis-hierarchy-gui-e2e-coverage]]).

**Detox** is a reasonable alternative if TypeScript helper APIs (closer to
Playwright) are required; higher native setup cost. **Appium** is heavier than
needed for the GUI-parity ladder.

Playwright cannot drive the native RN shell the way it drives the GUI webview.

## Proposed layout

```
mobile/e2e/
  smoke.yaml              # launch, see Identities / tabs
  identity.yaml           # create, set server, publish
  hierarchy.yaml          # two-identity propose/accept/tree (port GUI hierarchy.spec)
  helpers/                # shared Maestro flows or scripts
scripts/
  mobile-e2e.sh           # start server (+ optional postgres), emulator, run maestro
```

Root task (suggested): `deno task test:e2e:mobile` → wrapper that:

1. Prepares `test-results/mobile-e2e-*` isolation (or clears app data).
2. Starts key server on `:8788` with the same env pattern as Playwright
   `webServer` (SQLite default; Postgres via existing e2e script).
3. Ensures emulator/device + installs debug or release APK.
4. Points the app at `http://10.0.2.2:8788` (Android emulator loopback to host)
   or an injectable test server URL.
5. Runs Maestro against `mobile/e2e/`.

## App readiness work (before useful specs)

| Need | Why |
|------|-----|
| Stable `testID`s on primary controls | Mobile has sparse `accessibilityLabel`s; GUI relies on `#ids` / roles. Add `testID`s for nav tabs, generate identity, password field, server URL, publish, Certificates propose/accept, hierarchy tree. |
| Deterministic server URL in tests | Settings must be settable (or deep-link / launch arg) to the e2e server without manual UI flakiness. |
| Clearable app storage | Mirror GUI’s fresh `HOME`; clear `DocumentDirectory/ebp/` between runs or use a test-only reset. |
| Android-first path | Document emulator + APK install; iOS/TestFlight later ([[analysis-mobile-standalone-install]]). |

## Spec ladder (mirror GUI)

| Phase | Spec | Port from |
|-------|------|-----------|
| 0 | Smoke: app launches, main tabs visible | `gui/e2e/smoke.spec.ts` |
| 1 | Create identity + set server + publish | `gui/e2e/identity.spec.ts` |
| 2 | Hierarchy propose/accept + tree assert | `gui/e2e/hierarchy.spec.ts` |
| 3 | Mail (optional, credential-gated) | `gui/e2e/mail.spec.ts` |

Phase 2 closes the “Mobile Certificates UI propose/accept E2E” gap in
[[analysis-hierarchy-gui-e2e-coverage]]. GUI↔mobile interop remains a **later**
suite (two clients + shared server), not part of framework MVP.

## Out of scope for MVP

- GUI↔mobile propose/accept interop E2E
- Full mail provider matrix on device
- iOS CI (until release install path is documented)
- Replacing Jest unit / `test/mobile-parity_test.ts` (keep those)

## Implementation checklist

1. Add Maestro + `mobile/e2e/smoke.yaml`; wire `scripts/mobile-e2e.sh` + deno task.
2. Instrument `testID`s on Identities / Settings / Certificates critical paths.
3. Reuse server bootstrap env from `playwright.config.ts` (port 8788, rate limit off).
4. Port identity publish happy path; then hierarchy two-identity flow.
5. Document local run in `mobile/` README or `mobile/MAIL.md`-adjacent testing note.
6. Optionally gate CI on Android emulator job once smoke is stable.

## Related

- [[component-mobile]]
- [[component-gui]]
- [[component-server]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-mobile-standalone-install]]
- [[analysis-mobile-certificates-ux]]
- [[analysis-gui-mobile-parity-deltas]]

## Sources

- `playwright.config.ts`
- `gui/e2e/smoke.spec.ts`, `identity.spec.ts`, `hierarchy.spec.ts`, `mail.spec.ts`
- `deno.json` (`test:e2e`, `test:e2e:psql`)
- `scripts/e2e-with-postgres.sh`
- `mobile/package.json`
- [[analysis-hierarchy-gui-e2e-coverage]]
