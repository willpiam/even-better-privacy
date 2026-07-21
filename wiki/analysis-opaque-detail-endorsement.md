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

**Implemented (2026-07-21).** Cleartext `email` and hashed `opaque::email` endorsement both work via the server verify-email link flow. Clients send cleartext for the opaque path; the server hash-checks against the published detail and never stores cleartext in `details.detail`.

## Behavior

| Layer | Behavior |
|-------|----------|
| Server request | `POST /api/v1/verify-email/request` accepts optional `path` (`email` default, or `opaque::email`). Opaque branch requires `sha256Hex(detail) ===` stored hash; mail goes to client cleartext. |
| Server confirm | `POST /api/v1/verify-email` accepts tokens for `email` **or** `opaque::email`; sets `verified_at` / `detailsMeta[path].verified` |
| Auto-send on attach | Still **email-only** (`POST /api/v1/detail`); opaque verification is explicit via request |
| GUI | Verify button for `email` and `opaque::email`; opaque prompts for cleartext |
| Mobile | Same; `addDetail` hashes `opaque::` paths before attach/push |

## Implementation notes

- Fragment token links (`#token=`) for request and cleartext attach auto-send (F-SERVER-09).
- SQLite adapter binds large ms timestamps as strings and CAST-reads verification time columns (avoids 32-bit overflow in `@db/sqlite`).

## Related Pages

- [[identity-model]]
- [[component-server]]
- [[overview]]
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-compose-recipient-resolve]]

## Sources

- `server/verify-email.ts`
- `server/db/sqlite.ts`, `server/db/index.ts`
- `gui/js/render.js`, `gui/local-backend/routes.ts`
- `mobile/src/services/contacts.ts`, `mobile/src/services/details.ts`
- `mobile/src/screens/IdentityDetailScreen.tsx`
- [[identity-model]]
- [[component-server]]
