# Wiki Log

## [2026-04-12] ingest | RFC 8391 (XMSS) and NIST SP 800-208 (Stateful HBS)

- Ingested two stateful hash-based signature sources from `wiki/raw/`:
  - `rfc8391.txt` → Created [[source-rfc-8391]] (XMSS: WOTS+, single-tree, multi-tree parameter sets, security proofs).
  - `NIST.SP.800-208.pdf` → Created [[source-sp-800-208]] (Federal recommendation for LMS/XMSS, approved parameter sets, conformance requirements, state management).
- Updated [[slh-dsa]] with new "Stateless vs Stateful Hash-Based Signatures" section explaining the XMSS/LMS context and why EBP chose the stateless SLH-DSA.
- Updated [[overview]] with references to stateful HBS predecessors.
- Updated [[index.md]] source summaries section with two new entries.

## [2026-04-10] update | message-payload-formats receive-side handling

- Updated [[message-payload-formats]] to document receive-side identity resolution priority (local contacts → server → embedded keys).
- Documented `serverIdentityMatch` cross-check for embedded identity verification.
- Documented sender contact auto-fill behavior.

## [2026-04-10] create | message-payload-formats

- Created [[message-payload-formats]] page documenting the wire format for all EBP message payload types.
- Covers `ebp-encrypted-signed-message`, `ebp-encrypted-message`, `ebp-signed-message`, and `ebp-signature` with field-level tables.
- Documents armor wrapping, ciphertext structure (ML-KEM encapsulated key + AES-256-GCM), inner payload layout, and the key-material-vs-fingerprint design decision.
- Documents the GUI native email compose/decrypt flow end-to-end.
- Added to [[index.md]] under Core Concepts.

## [2026-04-08] lint | wiki-health-check

Lint pass findings and fixes:
- **Missing pages:** Created [[component-mobile]] and [[fn-dsa]] (both listed in taxonomy but absent).
- **Orphan risk:** All pages now have inbound links from index.md and at least one other page.
- **Stale seeds upgraded:** All seed pages (ml-kem, ml-dsa, slh-dsa, identity-model, revocation-system, component-cli, component-gui, component-server, component-email-extension) upgraded to `active` with codebase-sourced implementation details.
- **Source summaries populated:** Section was empty; now has three FIPS standard summaries.
- **Wikilinks verified:** No broken wikilinks found after updates.
- **Rule migration:** Moved `.cursorrules` → `.cursor/rules/wiki-maintainer.mdc` with proper Cursor frontmatter. Added workflow trigger phrases to schema.

## [2026-04-08] ingest | NIST FIPS 203, 204, 205

- Ingested three NIST FIPS standards from `wiki/raw/`:
  - `NIST.FIPS.203.pdf` → Created [[source-fips-203]] (ML-KEM standard summary).
  - `nist.fips.204.pdf` → Created [[source-fips-204]] (ML-DSA standard summary).
  - `NIST.FIPS.205.pdf` → Created [[source-fips-205]] (SLH-DSA standard summary).
- Updated [[ml-kem]], [[ml-dsa]], [[slh-dsa]] with FIPS parameter tables, implementation details from codebase, and source citations.
- Updated [[overview]] with FIPS standard references and scheme summary table.
- Updated [[index.md]] source summaries section.

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

## [2026-04-09] update | detail update workflow docs

- Documented the revoke-before-replace constraint for identity details across four wiki pages.
- [[identity-model]]: Added "Updating a Detail" subsection explaining that each path allows one active value, the server enforces this with 409 Conflict, and the two-step revoke-then-set workflow.
- [[revocation-system]]: Added note to Detail Revocation that revocation is a prerequisite for updating a detail.
- [[component-server]]: Added detail uniqueness enforcement note under the Details API section.
- [[component-cli]]: Added practical workflow guidance under the Details commands section.

## [2026-04-09] create | component-website

- Created [[component-website]] page documenting the static public site (`website/`).
- Covers landing page content, browser-based signature verifier (supported types, inputs, server integration), privacy page, deployment/assets, and design notes.
- Added to [[index.md]] under Components.
- Cross-linked from [[component-server]] (verifier is a consumer of the verify-signature endpoint).

## [2026-04-09] update | component-gui toast and file-save docs

- Documented toast notification system (setStatus, auto-dismiss, animation) in [[component-gui]].
- Documented backend-routed file save mechanism (`POST /api/v1/save-file`) and why blob-URL downloads were replaced.

## [2026-04-05] ingest | initial-wiki-bootstrap

- Initialized wiki framework structure (`wiki/`, `wiki/raw/`).
- Added maintainer schema in `.cursorrules`.
- Created initial `index.md`, `overview.md`, and seed pages.
