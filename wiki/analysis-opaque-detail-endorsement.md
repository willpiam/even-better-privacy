---
title: "Opaque Detail Endorsement Status"
type: analysis
status: active
last_updated: 2026-07-21
source_count: 8
tags:
  - analysis
  - opaque-details
  - verify-email
  - endorsement
  - server
---

# Opaque Detail Endorsement Status

## Verdict

**Not working yet.** Cleartext `email` detail endorsement via the server verify-email link flow **is** implemented. Endorsement of `opaque::email` (hashed/opaque detail endorsement) is **not**: the server and clients hard-code path `"email"` and never verify opaque email paths.

[[overview]] correctly still lists “Hashed/opaque detail endorsement” under upcoming features. This page replaces the earlier uncertainty note on [[analysis-mobile-encrypted-mail-reader-ux]].

## What works today (cleartext email)

| Layer | Behavior |
|-------|----------|
| Server request | `POST /api/v1/verify-email/request` loads `getDetailRecord(db, fingerprint, "email")`, checks cleartext `detail` match, emails a fragment token link ([[component-server]], `server/verify-email.ts`) |
| Server confirm | `POST /api/v1/verify-email` accepts tokens only when `record.path === "email"`; sets `verified_at` |
| Auto-send on attach | `POST /api/v1/detail` sends a verification email only when `path === "email"` (`server/handlers/identity.ts`) |
| Public signal | `detailsMeta.email.{ verified, verifiedAt }` on identity/discovery responses |
| GUI | Verify button only for `item.path === "email"` (`gui/js/render.js`) |
| Mobile | `requestVerifyEmail` posts fingerprint + cleartext detail; UI wired for cleartext email on identity details |

Opaque **storage and matching** (not endorsement) already work: clients hash with `sha256Hex` before attach/push; contacts can match From/To against `opaque::email` ([[identity-model]], [[analysis-mobile-compose-recipient-resolve]]).

## Why opaque endorsement fails

1. **Hard-coded path.** Request/confirm refuse anything other than `"email"`. An `opaque::email` row is never selected for verification tokens.
2. **No cleartext on the server.** Published opaque value is `SHA-256(email)`, not the address. `sendVerificationEmail(to, …)` needs a deliverable `to`. Today the server uses `record.detail` (fine for cleartext email; useless for a hex hash).
3. **No hash-check request API.** The request body already carries client-supplied `detail`, but only for equality against cleartext `email`. There is no branch: if path is `opaque::email`, require `sha256Hex(providedDetail) === record.detail`, then send mail to `providedDetail` without persisting cleartext.
4. **Client UX.** GUI/mobile do not offer “Send verification link” for opaque email (and must prompt for cleartext if only the hash is synced).

## What it would take to make it work

### Server (required)

1. Extend `handleRequestVerifyEmail` to accept a path (or detect `opaque::email`):
   - Load detail at `opaque::email` (and keep existing `email` path).
   - For opaque: require client cleartext; verify `sha256Hex(cleartext) === stored hash`; reject on mismatch; send mail **to cleartext**; store verification token against path `opaque::email`.
   - Do **not** write cleartext into `details.detail` (remain hash-only). Avoid logging the address beyond SMTP needs.
2. Relax confirm: allow `record.path === "email" || record.path === "opaque::email"` (or any allow-listed email-like path).
3. Optionally auto-offer verification when attaching `opaque::email` — only if the attach API also receives ephemeral cleartext (today push sends only the hash). Prefer explicit `verify-email/request` with cleartext from the holder’s device (they still know the address).
4. Tests: opaque happy path, hash mismatch, revoked opaque, confirm sets `detailsMeta["opaque::email"].verified`, ensure cleartext never stored in detail value.

### Clients (required for usable product)

1. **GUI / mobile identity details:** for `opaque::email`, show verify action that prompts for the cleartext address (or uses local `resolvedOpaqueDetails`), then calls verify-email/request with that cleartext.
2. **Mail authenticity UI** ([[analysis-mobile-encrypted-mail-reader-ux]]): treat `detailsMeta["opaque::email"].verified` like cleartext email endorsement once server supports it.
3. **CLI:** optional `ebp verify-email --opaque` (or path flag) sending cleartext for hash check.

### Design choices to decide

| Choice | Notes |
|--------|-------|
| One path vs both | Allow both `email` and `opaque::email` on one identity? Uniqueness is per path today; both can coexist. Authenticity UI should state which path matched From. |
| Auto-send on opaque attach | Needs cleartext at attach time; attach/push currently hashes client-side and may never send cleartext to the server — request endpoint is the natural place. |
| Token in fragment | Keep F-SERVER-09 fragment pattern; attach-path still has a legacy `?token=` link in `identity.ts` for cleartext email — opaque work should use fragment-only links. |
| Scope beyond email | “Hashed/opaque detail endorsement” in [[overview]] might mean any opaque path; shipping **opaque::email** endorsement first matches mail authenticity. Other opaque paths have no mailbox to receive a link. |

### Out of scope / already fine

- Opaque hash publish/resolve (`resolve-opaque`, compose matching).
- `detailsMeta` plumbing for arbitrary paths (DB already keys by path once `verified_at` is set).

## Related Pages

- [[identity-model]]
- [[component-server]]
- [[overview]]
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-weakest-defined-architecture-concepts]]
- [[email-transport]]

## Sources

- `server/verify-email.ts` (`handleRequestVerifyEmail`, `handleVerifyEmailConfirm` — path `"email"` only)
- `server/handlers/identity.ts` (auto verify send only for `path === "email"`)
- `gui/js/render.js` (verify UI only for `email`)
- `mobile/src/services/contacts.ts` (`requestVerifyEmail`)
- `gui/local-backend/routes.ts` / `cli/commands/details.ts` (opaque attach hashes with `sha256Hex`)
- [[identity-model]]
- [[component-server]]
- [[overview]]
