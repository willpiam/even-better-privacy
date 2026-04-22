---
title: "EBP Audit Findings Register — April 2026"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - findings
---

# Findings Register

Single source of truth for all findings raised during the April 2026 [[README|EBP Security Audit]]. New findings are appended; status changes are noted in-line.

## Severity rubric

- **Critical** — Direct compromise of A1/A2 (private keys) or full server takeover. Realistic remote exploitation.
- **High** — Significant impact (identity impersonation, message decryption, revocation bypass) under realistic adversary model.
- **Medium** — Limited or conditional impact, or requires non-trivial preconditions.
- **Low** — Defense-in-depth or local-only impact with mitigations available.
- **Informational** — Hardening recommendation, no exploitable issue.

CVSS 3.1 scores are advisory and use the EBP-specific environmental considerations described per finding.

## Findings table

| ID | Severity | Component | Title | Status |
|---|---|---|---|---|
| F-CRYPTO-01 | High | core | Emergency revocation certificate uses nonce 0 which collides with first regular revocation, silently consuming the emergency slot | fixed (2026-04-22) |
| F-CRYPTO-02 | High | core | Surreptitious forwarding: signed-then-encrypted payload does not bind sender to recipient (Davis 2001) | fixed (2026-04-22) |
| F-CRYPTO-03 | Medium | core | Signature envelope lacks per-purpose domain separation (single `ebp::messagehash::` envelope reused across messages, detail proofs, revocations) | open |
| F-CRYPTO-04 | Medium | core | Fingerprint leaf hashing is inconsistent: signing leaf hashes decoded bytes while encryption leaf hashes hex-string bytes | open |
| F-CRYPTO-05 | Medium | core | Detail-proof and revocation-cert signing payloads rely on `JSON.stringify` insertion-order rather than canonical JSON | open |
| F-CRYPTO-06 | Medium | core | `Identity.fromStorageFormat` constructs Identity via `Object.create` bypassing constructor invariants; later signing on public-only instance fails opaquely | open |
| F-CRYPTO-07 | Low | core | Hierarchy certificate signing payload uses `::` joining over user-supplied `context` field; not a parser-secure encoding | open |
| F-CRYPTO-08 | Low | core | `Hex.hexToBytes` accepts any character via `parseInt(_, 16)` rather than validating `[0-9a-fA-F]` (NaN bytes become 0) | open |
| F-CRYPTO-09 | Low | core | `Identity.signAndEncryptMessage` builds inner JSON `{message, signature}` with no version/type tag — parser ambiguity | open |
| F-CRYPTO-10 | Informational | core | `MAX_CONTEXT_LENGTH` for hierarchy is 256 chars but no length cap on `reason` strings in revocation certs | open |
| F-CRYPTO-11 | Informational | core | `PROTOCOL_VERSION` is `0.0.1` and `isProtocolVersionSupported` only compares major+minor — patch ignored | open |
| F-SERVER-01 | High | server | Reflected XSS in `GET /api/v1/verify-email` — token query param interpolated unescaped into HTML response | fixed (2026-04-22) |
| F-SERVER-02 | High | server | Unauthenticated deletion of pending hierarchy proposals: `POST /api/v1/hierarchy/reject` requires no signature, only a fingerprint that is part of the proposal | fixed (2026-04-22) |
| F-SERVER-03 | High | server | `getClientIp` blindly trusts `X-Forwarded-For`; rate-limit bypass and log forgery on any deployment without a strict reverse proxy | fixed (2026-04-22) |
| F-SERVER-04 | Medium | server | Default `ALLOWED_ORIGINS=*`, no Host validation, no CSP, no `X-Content-Type-Options`, no `Referrer-Policy` | open |
| F-SERVER-05 | High | server | Dockerfile runs as root (no `USER` directive) — broader blast radius for any RCE | fixed (2026-04-22) |
| F-SERVER-06 | Medium | server | SQLite adapter does not set `PRAGMA foreign_keys = ON`; declared FK constraints are advisory | open |
| F-SERVER-07 | Medium | server | Search `LIKE %query%` does not escape `%`/`_`; attacker-controlled wildcards force expensive scans | open |
| F-SERVER-08 | Medium | server | Identity-existence enumeration via registration response codes (200 vs 400 vs 404) | open |
| F-SERVER-09 | Medium | server | Email-verification token transmitted in URL — leaks via access logs, browser history, future Referer headers | open |
| F-SERVER-10 | Low | server | Email-verification fallback compares plaintext token via SQL `=`; not constant-time. Mitigated by `EMAIL_VERIFICATION_STORE_PLAINTEXT=false` default | open |
| F-SERVER-11 | Informational | server | `computeSigningRawFingerprint` invoked only for side-effect of throwing on bad keys; explicit `validatePostQuantumKey` would be clearer | open |
| F-SERVER-13 | Low | server | Server `main.ts` references non-existent `./db.ts`; `deno check server/main.ts` fails. Repo is in build-broken state on master | open |
| F-GUI-01 | Critical | gui-local-backend | Universal cross-origin access: CORS `*` + no Host check + no CSRF token allows any browser tab to read identities, contacts, mail accounts, drop arbitrary `~/Downloads/` files, hijack mail OAuth, etc. | fixed (2026-04-22) |
| F-GUI-02 | Medium | gui-local-backend | `/api/v1/save-file` overwrites existing files in `~/Downloads/` without confirmation | open |
| F-GUI-03 | Medium | gui-local-backend | Deno permissions in `tasks.gui` are unconstrained (`--allow-read`, `--allow-write`, `--allow-net`, `--allow-run`, `--allow-sys`, `--allow-env`) | open |
| F-GUI-04 | Low | gui-local-backend | `/api/v1/mail/oauth/open-browser` permits any HTTPS URL — usable for forced phishing-tab opens via F-GUI-01 | open |
| F-GUI-05 | High (cond.) | gui-local-backend | `mailparser` and `imapflow` parse attacker-controlled MIME / IMAP traffic — pending dependency CVE check (Phase 6) | open |
| F-GUI-06 | Medium | gui-local-backend | `/api/v1/sign` requires only the password — no per-action OS-native confirmation of *what* is being signed | open |
| F-GUI-07 | Low | gui-local-backend | Client UI does not display recipient binding for encrypt+sign; cross-reference F-CRYPTO-02 fix | open |
| F-GUI-08 | Medium | gui-local-backend | `readJson` has no body-size cap; cross-origin OOM via streaming megabodies | open |
| F-GUI-09 | Low | gui-local-backend | `/api/v1/context` and `/save-file` leak full home/disk paths in responses — tailored-attack input via F-GUI-01 | open |
| F-GUI-10 | Medium | gui-local-backend | `mailOauthStarts` Map can be flooded cross-origin to exhaust memory (DoS) | open |
| F-GUI-11 | Low | gui-local-backend | Static-file traversal check runs on single-decoded path; double-encoded `%252e%252e` not re-checked. Likely safe via URL normalisation but worth hardening | open |
| F-GUI-12 | Low | gui-local-backend | Mail-OAuth callback HTML interpolates provider-supplied `error`/`message` strings without HTML escaping | open |
| F-CLI-01 | High | cli | `readPassword` does not disable terminal echo; password visible to shoulder-surfing, scrollback, terminal recorders | fixed (2026-04-22) |
| F-CLI-02 | Medium | cli | `--password` flag accepts secret in shell history; only documented warning, no runtime warning | open |
| F-CLI-03 | Medium | cli | Persisted `server` URL not scheme-checked; HTTP server URLs silently accepted | open |
| F-CLI-04 | Low | cli | `safeFileName` does not cap length | open |
| F-CLI-05 | Informational | cli | `parseArgs` silently accepts unknown flags | open |
| F-CLI-06 | Low | cli | Wrong-password and corruption errors are conflated | open |
| F-WEB-01 | Medium | website | Verifier trusts server `body.verified` boolean; no client-side cryptographic verification | fixed (2026-04-22) |
| F-WEB-02 | Medium | website | Server URL input accepts `http://` without warning | open |
| F-WEB-03 | Medium | website | No CSP set on `verify.html` | open |
| F-WEB-04 | Low | website | `JSON.parse` on attacker-pasted content (mitigated by V8/SpiderMonkey safe handling of `__proto__`) | open |
| F-TAURI-01 | High | tauri | `allowlist.shell.open=true` with no scope; webview can open arbitrary URL schemes | fixed (2026-04-22) |
| F-TAURI-02 | High | tauri | No CSP set on Tauri webview | open |
| F-TAURI-03 | Medium | tauri | Sidecar resolution falls back to PATH-like locations; same-named binary near exe could be substituted | open |
| F-TAURI-04 | Informational | tauri | Only `appimage` target in Tauri bundle config; mac/win build & signing handled by external scripts (Phase 6) | open |
| F-TAURI-05 | Low | tauri | Sidecar log file created with default permissions (0644) — readable by other users on multi-user systems | open |
| F-DEP-01 | Medium | supply-chain | Transitive `nodemailer` < 8.0.4 has SMTP command-injection CVEs (GHSA-c7w3-x93f-qmm8, GHSA-vvjj-xcjg-gr5g) | fixed (2026-04-22) |
| F-DEP-02 | High | supply-chain | Tauri 1.6 ships `tar 0.4.44` (RUSTSEC-2026-0067/0068), `rand` unsoundness, and 15 unmaintained-crate warnings; migrate to Tauri 2.x | mitigated (2026-04-22: shell-open scoped, full 2.x migration still open) |
| F-DEP-03 | Low | supply-chain | `deno.land/std@0.224.0` is from early 2024; migrate to JSR `@std/*` | open |
| F-DEP-04 | Low | supply-chain | `deno.land/x/sqlite@v3.9.1` and `deno.land/x/postgres@v0.17.0` outdated; ecosystem moving to JSR | open |
| F-DEP-05 | Informational | supply-chain | `@playwright/test` bundles Chromium — dev-machine attack surface | open |
| F-BUILD-01 | Medium | build | Linux build downloads `appimagetool` from `continuous` GitHub-release tag without checksum verification | open |
| F-BUILD-02 | Informational | build | Linux AppImage uses hand-stitched repackage step that bypasses Tauri's bundle pipeline | open |
| F-BUILD-03 | Informational | build | Build scripts use `npm install` instead of `npm ci`; not deterministic | open |
| F-BUILD-04 | Low | build | Mail OAuth client IDs baked into Tauri binary at compile time; one ID across all installs | open |
| F-DOCKER-01 | Low | docker | Image pinned by tag (`denoland/deno:2.6.6`) not by digest; tag mutation / registry compromise risk | open |
| F-DOCKER-02 | Low | docker | No `.dockerignore`; `COPY core ./core` / `COPY server ./server` may include stray local files (e.g. `.env`, `*.log`) | open |
| F-SECRETS-01 | Informational | supply-chain | No committed secrets observed in source tree; full historical `gitleaks` scan still recommended | open |
| F-SECRETS-02 | Informational | supply-chain | `ebp.sqlite` and `test_identities/` shipped with documented test passwords; risk of misuse if reused | open |
| F-SUPPLY-01 | Informational | supply-chain | No reproducible-build process documented; release-asset compromise undetectable | open |
| F-STORAGE-01 | High | storage | Identity files written with default 0644; world-readable encrypted-key blob enables offline brute force by any local user / process | fixed (2026-04-22) |
| F-STORAGE-02 | Medium | crypto/storage | PBKDF2-HMAC-SHA256 at 310,000 iterations is below OWASP 2024 baseline (≥600,000); migrate to Argon2id | fixed (2026-04-22; Argon2id follow-up still open) |
| F-STORAGE-03 | Low | crypto/storage | AES-GCM ciphertext lacks AAD bind to format version; potential downgrade attack on future format expansion | open |
| F-STORAGE-04 | Medium | storage | `~/.ebp/` created with default mode (0755); identity-name enumeration by other local users | fixed (2026-04-22) |
| F-STORAGE-05 | Low | storage | `state.json` (current identity + server URL) written 0644 | open |
| F-STORAGE-06 | Medium | storage | Emergency revocation certificate exported with default 0644; world-readable kill-switch on disk | open |
| F-STORAGE-07 | Low | storage | Public-only loaded `Identity` is not type-distinguished from private-loaded; sign attempts fail at runtime instead of compile time | open |
| F-STORAGE-08 | Low | storage | Decrypted private-key JSON not cross-checked against `pub.signingKeyType` before key construction | open |
| F-STORAGE-09 | Low | storage | Password floor is 8 chars; no complexity policy; no strength meter | open |
| F-STORAGE-10 | Low | storage | `state.json` is unauthenticated; local attacker with write access can silently substitute server URL | open |
| F-STORAGE-11 | Informational | storage | `test_identities/` and `ebp.sqlite` shipped with documented passwords (cross-ref F-SECRETS-02) | open |

(Additional findings will be appended as later phases complete.)

## Open questions

- Q1: Does `@noble/post-quantum` ML-DSA use hedged (randomized + deterministic) signing per FIPS 204, or pure deterministic? Resolved (hedged by default).
- Q2: Does the server re-verify every detail proof on `POST /api/v1/identity`, or accept whatever the client uploaded? Resolved: identity registration creates an empty-detail state; details are created via separate `/detail` POST which DOES verify proofs.
- Q3: Does the local backend listen on `127.0.0.1` only, or on `0.0.0.0`? (`--allow-net` is unrestricted in `deno.json`.) — Phase 4.
- Q4: Does the Tauri webview enforce a CSP for the local backend origin? — Phase 5.

## Related Pages

- [[README]]
- [[threat-model]]
- [[phase-02-crypto-core]]
