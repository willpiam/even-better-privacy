---
name: Mobile E2E Identity Crypto
overview: Harden the passing Android Maestro harness, then add identity-detail and sign/verify flows that mirror a useful subset of GUI Playwright identity tests—without mail, iOS, or GUI↔mobile interop.
todos:
  - id: wiki-harness
    content: Update analysis-mobile-e2e-framework + mobile/e2e/README for USB reverse, SQLite, env-override pitfalls, autofill helper
    status: pending
  - id: testids-crypto-details
    content: Add testIDs on Identity details, Crypto hub, Sign/Verify, Contacts fetch/search
    status: pending
  - id: flow-details
    content: "Write details.yaml: push detail + searchable on Contacts; optional wrong-password publish"
    status: pending
  - id: flow-sign-verify
    content: "Write sign-verify.yaml: sign message, verify payload, dismiss autofill on password modal"
    status: pending
  - id: runner-tasks
    content: Include new flows in mobile-e2e.sh default list and deno tasks
    status: pending
isProject: false
---

# Next mobile E2E: harden + identity/crypto

Android Maestro already covers smoke, HD publish, and two-identity hierarchy (`deno task test:e2e:mobile`, **3/3 passed**). Wiki/harness docs are stale, Crypto/Contacts/detail fields still lack `testID`s, and GUI [`gui/e2e/identity.spec.ts`](gui/e2e/identity.spec.ts) has several happy paths mobile does not.

## Leave for later

- Mail E2E (needs `TEST_EMAIL_*` like [`gui/e2e/mail.spec.ts`](gui/e2e/mail.spec.ts))
- GUI ↔ mobile hierarchy interop
- iOS Maestro / CI emulator
- GUI revoke-identity / browse-trust tests (heavier; skip this increment)

## 1. Catch up docs and harness notes

Update [[analysis-mobile-e2e-framework]] and [`mobile/e2e/README.md`](mobile/e2e/README.md):

- Physical phone uses `adb reverse` + `SERVER_URL=http://127.0.0.1:8788` (not hardcoded `10.0.2.2`).
- `DENO_SQLITE_PATH` for Ubuntu 22.04 GLIBC; reuse Metro via `MOBILE_E2E_SKIP_METRO=1`.
- Helpers now include `dismiss-autofill.yaml`; do not put `SERVER_URL` / `IDENTITY_NAME` defaults in helper `env:` (Maestro overwrites CLI/`runFlow` env).

Keep [`scripts/mobile-e2e.sh`](scripts/mobile-e2e.sh) as-is unless a small comment is needed.

## 2. Stamp testIDs for the new flows

| Screen | IDs |
|--------|-----|
| [`IdentityDetailScreen.tsx`](mobile/src/screens/IdentityDetailScreen.tsx) | `identity-detail-path`, `identity-detail-value`, `identity-detail-push`, `identity-add-detail` |
| [`CryptoHubScreen.tsx`](mobile/src/screens/CryptoHubScreen.tsx) | `crypto-sign-message`, `crypto-verify-message` |
| [`SignMessageScreen.tsx`](mobile/src/screens/crypto/SignMessageScreen.tsx) | `sign-message-input`, `sign-message-submit`, `sign-message-output` |
| [`VerifyMessageScreen.tsx`](mobile/src/screens/crypto/VerifyMessageScreen.tsx) | `verify-payload-input`, `verify-submit` |
| [`ContactsScreen.tsx`](mobile/src/screens/ContactsScreen.tsx) | fetch/search controls used after detail push |

Reuse existing `PasswordModal` ids + [`helpers/dismiss-autofill.yaml`](mobile/e2e/helpers/dismiss-autofill.yaml) on sign confirm.

## 3. New Maestro flows (mirror GUI, keep suite split)

Add two flows; wire them into the default runner after `identity.yaml` (before hierarchy so a details failure is cheaper than 4m of HD keygen—or after identity, still before hierarchy):

| Flow | Port of GUI test | Assert |
|------|------------------|--------|
| `mobile/e2e/details.yaml` | `pushes identity detail to server and it becomes searchable` | HD create + publish, add path/value with push, Contacts fetch/search shows the detail |
| `mobile/e2e/sign-verify.yaml` | `verifies detached signature with provided public keys` (simplified: attached payload) | Sign message → copy payload → Verify → success banner |

Also add **wrong-password publish** as a short extra case in `identity.yaml` or `details.yaml`: type a bad password, tap Publish, assert error banner, no `Published.*`.

Do **not** port tamper/wrong-sender/revoke-identity in this increment.

## 4. Tasks

- `deno task test:e2e:mobile` runs smoke, identity, details, sign-verify, hierarchy.
- `deno task test:e2e:mobile:smoke` unchanged.
- Optional: `test:e2e:mobile:fast` = smoke + identity only.

## 5. Wiki after implementation

Refresh [[analysis-mobile-e2e-framework]] flow table and [[analysis-hierarchy-gui-e2e-coverage]] only if unchanged; append [`wiki/log.md`](wiki/log.md).
