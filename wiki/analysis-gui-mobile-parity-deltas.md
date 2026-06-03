---
title: "GUI vs Mobile Parity Deltas"
type: analysis
status: active
last_updated: 2026-06-02
source_count: 8
tags:
  - analysis
  - mobile
  - gui
  - parity
  - wire-format
---

# GUI vs Mobile Parity Deltas

Comparison of [[component-gui]] (Deno local backend + web/Tauri frontend) and [[component-mobile]] (React Native). **Interop drift** items below were remediated in June 2026 via shared `core/` modules; **feature gaps** remain for a separate plan.

## Interop drift — remediated (2026-06-02)

| Drift | Resolution |
|-------|------------|
| Decrypt without local contact | `core/SenderResolution.ts` + `tryResolveSenderForCtx` (GUI) / `resolveSenderForDecrypt` (mobile) |
| Multi-recipient decrypt | Mobile `decryptMessage` + GUI `/api/v1/decrypt` use `decryptAndVerifyMulti` |
| File payload `version` | `buildEncryptedFilePayload` / `buildEncryptedSignedFilePayload` in `core/FilePayload.ts` |
| Signing salt RNG | `core/CryptoUtils.ts` `randomHex(16)` |
| Password on create | Mobile uses `validatePassword` (CLI-default enforcement) |
| Armored paste | `core/PayloadInput.ts` `parseEbpPayloadInput` on mobile decrypt/verify screens |
| `ebp-signed-file` `fileName` | Mobile `signFile` includes `fileName`; shared `buildFileSignMessage` |
| Signed encrypt output | Mobile embeds `senderIdentity` when `sign=true` |

Shared modules: `core/PayloadInput.ts`, `core/SenderResolution.ts`, `core/CryptoUtils.ts`, `core/Fingerprint.ts` (`computeExternalFingerprint`). Tests: `test/interop-fixtures_test.ts`, fixtures under `test/fixtures/interop/`.

**Still intentional (not interop bugs):** separate storage roots (`~/.ebp/` vs app sandbox) — use export/import to move wallets.

## Missing features (GUI has; mobile lacks)

| Area | GUI | Mobile |
|------|-----|--------|
| **Native email** | SMTP/IMAP, OAuth, compose/decrypt ([[email-transport]]) | No mail stack |
| **Armor in compose** | Mail body armor wrap | Paste-only decrypt/verify (no compose armor) |
| **EBP-HD** | `/api/v1/hd/*` ([[ebp-hd]]) | No HD flows |
| **Desktop / extension** | Tauri, Chrome extension localhost API | N/A |
| **Password policy opt-out** | Settings toggle ([[password-policy]]) | Settings → “Enforce password policy” (default on) |
| **Settings breadth** | Mail prefs, credentials | Server URL only |
| **Email detail verification** | `verify-email` API + UI | No |
| **Opaque detail resolution** | `resolve-opaque` + UI | Re-import preservation only |
| **Contact local notes** | `update-local-notes` | No |
| **Sign confirmation** | GUI `/api/v1/sign` gate | In-process sign |
| **Mail attachment crypto** | Dedicated attachment payload types | No |
| **Identity import / delete** | Full lifecycle | Create + switch only |
| **Shared data directory** | `~/.ebp/` with CLI | App sandbox |
| **Hierarchy UX** | SVG tree, richer routes | Certificates screen |
| **File save helper** | `save-file` for Tauri | Share / copy |
| **April 2026 audit** | In scope | `mobile/` out of scope |

Mobile **does** cover: identity create, publish, details, revocation, contacts, sign/verify, encrypt/decrypt (message + file), hierarchy propose/accept, emergency certs.

## Aligned (unchanged)

- Revoked-details stripping on server sync ([[analysis-sync-revoked-details-bug]])
- Hierarchy proposal certificate hex encoding

## Sources

- [[component-gui]]
- [[component-mobile]]
- [[message-payload-formats]]
- [[password-policy]]
- `core/PayloadInput.ts`, `core/SenderResolution.ts`, `core/CryptoUtils.ts`, `core/FilePayload.ts`
- `gui/local-backend/sender-context.ts`
- `mobile/src/services/encryptDecrypt.ts`, `senderContext.ts`
