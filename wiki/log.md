# Wiki Log

## [2026-04-06] query | sync-revoked-details-bug

- Investigated why revoked details still appear after Sync From Server.
- Root cause: GUI local backend and mobile app did not strip `revokedDetails` from the server response before saving the contact.
- Fixed `gui/local-backend/main.ts` `/api/v1/fetch` handler and `mobile/src/services/contacts.ts` `normalizeExternalIdentity`.
- Created [[analysis-sync-revoked-details-bug]] page.

## [2026-04-05] ingest | initial-wiki-bootstrap

- Initialized wiki framework structure (`wiki/`, `wiki/raw/`).
- Added maintainer schema in `.cursorrules`.
- Created initial `index.md`, `overview.md`, and seed pages.
