---
title: "GUI vs Mobile Parity Deltas"
type: analysis
status: active
last_updated: 2026-06-04
source_count: 8
tags:
  - analysis
  - mobile
  - gui
  - parity
  - wire-format
---

# GUI vs Mobile Parity Deltas

Comparison of [[component-gui]] (Deno local backend + web/Tauri frontend) and [[component-mobile]] (React Native). **Interop drift** was remediated in June 2026 via shared `core/` modules. **Parity v1** feature gaps were closed in June 2026 per [[analysis-mobile-parity-roadmap]].

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

## Parity v1 checklist (2026-06-04)

| Item | Class | Mobile status |
|------|-------|---------------|
| Wire-format interop | must-have | done (2026-06-02) |
| Native Argon2 unlock | must-have | done |
| Identity import/export/delete | must-have | done |
| Contact opaque resolve + local notes | must-have | done |
| Verify-email on details | must-have | done |
| Sign confirmation gate | must-have | done |
| Settings (server, password policy, mail prefs, log) | must-have | done |
| Hierarchy tree (local + server merge) | must-have | done |
| EBP-HD mnemonic/derive/discover | must-have | done |
| Native email IMAP/SMTP/OAuth | must-have | done |
| Mail armor compose + attachments | must-have | done |
| Fingerprint-from-public on verify | must-have | done |
| Shared `~/.ebp/` on device | intentional gap | export/import |
| Tauri / Chrome extension | desktop-only | N/A |
| GUI `save-file` → Downloads | desktop-only | Share API |
| April 2026 audit GUI scope | governance | mobile scope doc added |

## Historical gaps (pre–Parity v1)

These were open before the June 2026 parity implementation; see
[[analysis-mobile-parity-roadmap]] for phase mapping.

| Area | Was missing on mobile |
|------|------------------------|
| Native email | mail stack in `mobile/src/services/mail/` |
| Armor in compose | `ebpMail.ts` + compose screen |
| EBP-HD | `hd.ts`, `HdCreateScreen.tsx` |
| Contact/detail UX | opaque, notes, verify-email |
| Identity lifecycle | import/delete/export |
| Hierarchy UX | merged tree in `CertificatesScreen` |

Mobile **covers** (baseline + Parity v1): identity create/import/export/delete,
publish, details, revocation, contacts, sign/verify (with confirm), encrypt/decrypt,
hierarchy, emergency certs, EBP-HD, native mail.

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
