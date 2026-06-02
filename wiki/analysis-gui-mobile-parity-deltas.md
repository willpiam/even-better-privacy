---
title: "GUI vs Mobile Parity Deltas"
type: analysis
status: active
last_updated: 2026-06-02
source_count: 6
tags:
  - analysis
  - mobile
  - gui
  - parity
  - wire-format
---

# GUI vs Mobile Parity Deltas

Comparison of [[component-gui]] (Deno local backend + web/Tauri frontend, actively maintained) and [[component-mobile]] (React Native, `seed` wiki status, last substantively aligned around April 2026 bugfixes). Grouped by **missing features** (GUI capability absent on mobile) and **format / implementation drift** (same feature exists but bytes, validation, or storage differ).

## Missing features (GUI has; mobile lacks)

| Area | GUI | Mobile |
|------|-----|--------|
| **Native email** | SMTP/IMAP, OAuth (Gmail/Outlook), compose/decrypt in mail UI ([[component-gui]], [[email-transport]]) | No mail stack |
| **Armored payloads** | `extractArmoredPayload` / `armorPayload` in mail and paste flows ([[message-payload-formats]]) | Re-exports from `core` but UI only handles raw JSON |
| **EBP-HD** | Mnemonic create/verify/discover via `/api/v1/hd/*` ([[ebp-hd]]) | No HD onboarding or derivation |
| **Desktop shell** | Tauri + sidecar ([[component-desktop]]) | N/A |
| **Chrome extension surface** | Local backend `127.0.0.1:8787` for [[component-email-extension]] | N/A |
| **Password policy** | `validatePassword` (12+, 3-of-4 classes) with Settings opt-out ([[password-policy]]) | Hard-coded **8-character minimum** in `createIdentity` |
| **Settings breadth** | Server URL, mail prefs, mail credentials, password-policy toggle | Server URL + identity path display only |
| **Email detail verification** | `POST /api/v1/verify-email/request` + UI | No |
| **Opaque detail resolution** | `POST /api/v1/contacts/resolve-opaque` + UI | Preserves `resolvedOpaqueDetails` on re-import only; no resolve UI |
| **Contact local notes** | `POST /api/v1/contacts/update-local-notes` | No |
| **Sign confirmation** | GUI `/api/v1/sign` requires recent `signConfirmation` (anti-misclick) | Signs immediately in-process |
| **Multi-recipient decrypt** | `ebp-encrypted-signed-message-multi` + `decryptAndVerifyMulti` | Unsupported payload types in `decryptMessage` |
| **Mail attachment crypto** | Dedicated mail attachment payload types / lazy fetch | No |
| **Encrypted email options** | `includePublicKeys` / `senderIdentity` in mail send & encrypt APIs | Encrypt paths never attach `senderIdentity` |
| **Identity import / delete** | Backend import, use/switch, delete flows | Create + list + switch via `state.json` only |
| **Shared data directory** | `~/.ebp/` same as [[component-cli]] | App sandbox `DocumentDirectory/ebp/` — no shared wallet with desktop |
| **Hierarchy UX** | SVG tree, list/pending server sync, richer local-backend routes | Text/json certificates screen; no `hierarchy/create` local route parity |
| **File save helper** | `POST /api/v1/save-file` for Tauri downloads | Share sheet / copy JSON only |
| **Website verifier** | N/A on GUI but public parity target | No in-app verifier |
| **April 2026 security audit** | In scope | [[security-audit-2026-04/README]] explicitly **out of scope** for `mobile/` |

Mobile **does** cover a large CLI-shaped subset: identity create, publish, details, revocation, contacts import/fetch/browse, sign/verify (message + file), encrypt/decrypt (message + file), hierarchy propose/accept/pending, emergency cert generation.

## Format / implementation drift

These are the highest-risk deltas for “works on desktop, fails on phone” (or vice versa).

### 1. Decrypt without local contact

- **GUI** `POST /api/v1/decrypt` for `ebp-encrypted-signed-message` can verify using `payload.senderIdentity`, server fetch, or known contact.
- **Mobile** `decryptMessage` always `loadContact(senderHint)` from `senderFingerprint` prefix or manual sender; **ignores embedded `senderIdentity`**.

Impact: GUI emails with “include public keys” decrypt on desktop without a saved contact; mobile fails unless the user imported the sender first.

### 2. Multi-recipient and versioned file payloads

- **GUI** encrypt-file responses include `version` (`ENCRYPTED_FILE_FORMAT_VERSION` / signed variant) per `core/version.ts`.
- **Mobile** `encryptFile` builds objects manually **without `version`**.
- **GUI** decrypt supports `ebp-encrypted-signed-message-multi`; **mobile** throws on unknown types.

### 3. Signing salt generation

- **GUI** `/api/v1/sign`: `randomHex(16)` when `includeSalt` is true; calls `signMessage(message, salt, "message")`.
- **Mobile** `signMessage`: `Math.random().toString(16).slice(2)` when salt enabled.

Impact: Interoperable signatures if both sign the same message+salt, but salt **distribution and entropy** differ; cross-client “default signed message” blobs are not guaranteed to match GUI defaults.

### 4. Password rules on new identities

- **GUI/CLI**: [[password-policy]] (12+ chars, complexity, blocklist).
- **Mobile**: `password.length < 8` only (`storage.ts`).

Impact: Identity created on mobile may be rejected when opened in GUI generate/import flows that enforce policy.

### 5. Storage layout and identity sharing

| | GUI / CLI | Mobile |
|---|-----------|--------|
| Root | `~/.ebp/` | `RNFS.DocumentDirectoryPath/ebp` |
| Contacts | `~/.ebp/contacts/*.json` | `.../ebp/contacts/*.json` |
| State | `current_identity` file in backend | `state.json` `{ currentIdentity }` |

Same **file formats** (`*.identity.json`, contact JSON) but **different roots** — not the same wallet unless users manually copy files.

### 6. Armored vs JSON-only UX

Wire format in [[message-payload-formats]] expects PEM-style armor for email transport. Mobile copy/paste path is JSON-only; users pasting GUI armored email bodies into mobile decrypt fields will fail unless they strip armor manually (no `extractArmoredPayload` in screens).

### 7. `ebp-signed-file` metadata

- **GUI** includes optional `fileName` in signed-file JSON (`gui/app.js`).
- **Mobile** omits `fileName`; core verify path uses hash + signature only — **usually compatible**, but exported artifacts differ.

### 8. Revoked-details normalization (aligned)

Both strip `revokedDetails` from `details` / `detailsMeta` after server fetch ([[analysis-sync-revoked-details-bug]]). This is a rare **fixed** parity point.

### 9. Hierarchy certificate encoding

Both use `stringToHex(JSON.stringify(cert))` for proposals — aligned with GUI local-backend.

## Suggested parity contract (wiki gap)

[[component-mobile]] and [[analysis-weakest-defined-architecture-concepts]] note missing “parity scope by capability.” Minimum contract for the next mobile refresh:

1. Import `validatePassword` on identity create (match CLI default).
2. Use `buildEncryptedSignedMessagePayload` / file builders from `core/Payloads.ts` (include `version`, optional `senderIdentity` toggle).
3. Decrypt: mirror GUI sender resolution order (embedded identity → contact → server).
4. Support `ebp-encrypted-signed-message-multi` decrypt if mail parity is deferred.
5. Add `extractArmoredPayload` on decrypt/sign paste inputs.
6. Document whether mobile targets shared `~/.ebp/` (likely no on iOS) or export/import only.

## Sources

- [[component-gui]]
- [[component-mobile]]
- [[message-payload-formats]]
- [[password-policy]]
- [[ebp-hd]]
- [[analysis-sync-revoked-details-bug]]
- [[analysis-weakest-defined-architecture-concepts]]
- `gui/local-backend/routes.ts`
- `mobile/src/services/encryptDecrypt.ts`
- `mobile/src/services/signVerify.ts`
- `mobile/src/services/storage.ts`
