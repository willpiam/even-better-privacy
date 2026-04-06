# Wiki Log

## [2026-04-06] query | stale-frontend-fix

- Diagnosed stale frontend assets in rebuilt AppImages caused by Cargo caching of Tauri `generate_context!()`.
- Implemented sidecar redirect: `distDir` now points to `desktop/dist/` containing a lightweight loader that redirects to the sidecar at `http://127.0.0.1:8787`.
- Created `desktop/dist/index.html` loader page; updated `tauri.conf.json` distDir.
- Reverted earlier workaround attempts (`build.rs` rerun-if-changed, `cargo clean -p` in build script).
- Updated [[analysis-linux-build]] with architecture details and fix rationale.

## [2026-04-06] query | linux-build

- Answered how to build EBP on Linux.
- Confirmed the documented local build path uses `build_desktop_linux.sh`.
- Captured required Linux packages, toolchain prerequisites, and output artifact in [[analysis-linux-build]].

## [2026-04-06] query | sync-revoked-details-bug

- Investigated why revoked details still appear after Sync From Server.
- Root cause: GUI local backend and mobile app did not strip `revokedDetails` from the server response before saving the contact.
- Fixed `gui/local-backend/main.ts` `/api/v1/fetch` handler and `mobile/src/services/contacts.ts` `normalizeExternalIdentity`.
- Created [[analysis-sync-revoked-details-bug]] page.

## [2026-04-05] ingest | initial-wiki-bootstrap

- Initialized wiki framework structure (`wiki/`, `wiki/raw/`).
- Added maintainer schema in `.cursorrules`.
- Created initial `index.md`, `overview.md`, and seed pages.
