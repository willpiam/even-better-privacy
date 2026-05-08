---
title: "EBP Security Audit — April 2026 — Final Report"
type: analysis
status: active
last_updated: 2026-05-01
source_count: 0
tags:
  - security-audit
  - report
---

# EBP Security Audit — April 2026 — Final Report

**Audit window:** 2026-04-18 (single-pass, multi-phase).  
**Scope:** [`core/`](../../core), [`cli/`](../../cli), [`server/`](../../server), [`gui/`](../../gui) (incl. [`gui/local-backend/`](../../gui/local-backend)), [`desktop/`](../../desktop) (Tauri shell), [`website/`](../../website), [`scripts/`](../../scripts), [`Dockerfile`](../../Dockerfile), [`deno.json`](../../deno.json) / [`deno.lock`](../../deno.lock), [`package.json`](../../package.json) / [`package-lock.json`](../../package-lock.json), [`build_*.sh`](../../build_desktop_linux.sh) build scripts, on-disk identity storage in `~/.ebp/`.  
**Out of scope (per request):** [`mobile/`](../../mobile), [`email/`](../../email) (Chrome extension). Note: the *attack surface* the email extension exposes on the GUI local backend (`http://127.0.0.1:8787`) IS in scope and forms the basis of the audit's most severe finding.

## Executive Summary

EBP's cryptographic primitives are sound: it correctly uses NIST FIPS-204 (ML-DSA), FIPS-203 (ML-KEM), and FIPS-205 (SLH-DSA) at Security Category 5, drawn from `@noble/post-quantum`. Symmetric encryption uses AES-256-GCM (AEAD) with proper random IVs and 128-bit salts. The frontend HTML rendering of received mail is well-isolated: a sandboxed iframe with `sandbox=""` plus a strict `default-src 'none'` CSP. The use of bech32 fingerprints provides per-identity HRP separation.

That said, this audit identified **75 findings** across the codebase, 12 of which are High or Critical severity. The single most severe issue — **F-GUI-01** — is a *Critical* design-level flaw in the GUI local backend that allows any malicious web page (visited in the same browser as the EBP app) to read all of the user's identities, contacts, and mail accounts, write arbitrary files to `~/Downloads/`, and pre-stage attacks on the user's mail provider OAuth flow — all without user consent. This was confirmed live with a curl-based PoC.

The next most impactful theme is **identity-storage hygiene** (F-STORAGE-01 through F-STORAGE-09): identity files are written to disk world-readable (`mode 0664`), the `~/.ebp/` directory is `0775`, and the password-derivation function (PBKDF2-HMAC-SHA256 at 310,000 iterations) is half the OWASP 2024 minimum. Combined, a low-privilege local process can grab an encrypted identity file and brute-force a typical 8-character password in days on commodity GPU hardware.

The **server** has a confirmed reflected XSS in `GET /api/v1/verify-email` (F-SERVER-01) and an unauthenticated DoS that lets any internet caller delete pending hierarchy proposals (F-SERVER-02). The repository's `master` branch is currently in a build-broken state for the server (F-SERVER-13: missing `./db.ts` import path, file is at `server/db/index.ts`), which prevented dynamic testing of server findings without a temporary local patch.

The **supply chain** is mostly clean (lockfile-pinned, no committed secrets), with two notable gaps: (a) the Tauri 1.x dependency tree carries 2 active RUSTSEC vulnerabilities and 15 unmaintained-crate warnings, and (b) the transitive `nodemailer < 8.0.4` has SMTP-command-injection CVEs. Migration to **Tauri 2.x** is the single largest supply-chain win and would also resolve several Tauri-specific findings.

The **website verifier** (`website/verify.html`) trusts the server's `verified: true` boolean rather than performing client-side cryptographic verification (F-WEB-01) — undermining the project's guarantee that "the server is just a directory; trust is cryptographic".

There are **no committed secrets**, no obvious crypto-misuse in primitives (CSPRNG everywhere, AEAD throughout, proper salt sizes), and the project has clearly received serious cryptographic engineering attention. The findings here cluster in *system design* (cross-origin / CSRF / file permissions) and *deployment posture* (CSP, headers, container hardening, dep upgrades) rather than in the crypto core.

### Risk posture

| Severity | Count | Examples |
|---|---|---|
| Critical | 1 | F-GUI-01 (cross-origin local-backend takeover) |
| High | 11 | F-CRYPTO-01, F-CRYPTO-02, F-SERVER-01, F-SERVER-02, F-SERVER-03, F-SERVER-05, F-CLI-01, F-TAURI-01, F-TAURI-02, F-DEP-02, F-STORAGE-01, F-GUI-05 (cond.) |
| Medium | 26 | F-CRYPTO-03..06, F-SERVER-04/06/07/08/09, F-GUI-02/03/06/08/10, F-CLI-02/03, F-WEB-01/02/03, F-TAURI-03, F-DEP-01, F-BUILD-01, F-STORAGE-02/04/06 |
| Low | 23 | F-CRYPTO-07..09, F-SERVER-10, several F-GUI-*, F-CLI-04/06, F-WEB-04, F-TAURI-05, F-BUILD-04, F-DOCKER-01/02, F-STORAGE-03/05/07-10, F-DEP-03/04 |
| Informational | 14 | F-CRYPTO-10/11, F-SERVER-11, F-CLI-05, F-TAURI-04, F-DEP-05, F-BUILD-02/03, F-SECRETS-01/02, F-SUPPLY-01, F-STORAGE-11 |

Full table in [[findings]].

### Top-12 prioritised remediation

1. **F-GUI-01** — add a per-launch CSRF token, restrict CORS to the Tauri webview origin only, validate the `Host` header. (Critical, immediate)
2. **F-STORAGE-01 / F-STORAGE-04** — write identity files at `0o600`, create `~/.ebp/` at `0o700`. One-line fix per write site. (High, immediate)
3. **F-SERVER-01** — HTML-escape the `token` query parameter in `verify-email.ts` before interpolation. (High, immediate)
4. **F-SERVER-02** — require a signature over `{proposalId, fingerprint, action: "reject"}` from the rejecting party's identity. (High)
5. **F-CRYPTO-02** — re-design encrypted-signed payload to bind the recipient fingerprint inside the signed data (encrypt-then-sign or include `recipientFingerprint` in the signed envelope). (High, design change)
6. **F-CRYPTO-01** — give the emergency revocation cert its own monotonically-increasing nonce space (e.g. `2^31 + n`) so it cannot be silently consumed by a regular revoke. (High)
7. **F-DEP-02** — migrate to Tauri 2.x; resolves F-TAURI-01 and F-TAURI-02 in one shot via Tauri 2's permissions/capabilities model. (High, week-scale work)
8. **F-CLI-01** — disable terminal echo on password prompt (`Deno.stdin.setRaw(true, { cbreak: true })`). (High, one-day fix)
9. **F-SERVER-03** — only honour `X-Forwarded-For` when an explicit `TRUST_PROXY` env is set; default to the socket peer IP. (High)
10. **F-SERVER-05** — add `USER deno` to Dockerfile. (High, one-line)
11. **F-STORAGE-02** — bump PBKDF2 to 600,000 iterations (or migrate to Argon2id). (Medium, one-line + storage-version bump)
12. **F-WEB-01** — perform client-side signature verification in the website verifier; trust the server only for fetching the published identity. (Medium, design change)

A full prioritised roadmap is in [Appendix A](#appendix-a---roadmap).

## Methodology

This audit was conducted in nine phases over a single pass:

1. **Threat model & scaffolding** — STRIDE per component, adversary capability matrix, trust-boundary diagram. ([[threat-model]])
2. **Cryptographic core review** — manual review of all 18 files in `core/`. ([[phase-02-crypto-core]])
3. **Server review** — `server/` (~3.0k LOC). ([[phase-03-server]])
4. **GUI local backend & frontend review** — `gui/local-backend/` (~3.6k LOC including a 2,835-line `routes.ts`) plus the static frontend. ([[phase-04-gui]])
5. **CLI, website verifier, Tauri shell** — `cli/`, `website/`, `desktop/src-tauri/`. ([[phase-05-cli-website-tauri]])
6. **Supply chain & build pipeline** — `npm audit`, `cargo audit`, manual review of build scripts and Dockerfile, secret scan. ([[phase-06-supply-chain]])
7. **Identity storage & key management** — AES envelope, KDF parameters, file permissions. ([[phase-07-storage]])
8. **Dynamic testing & PoCs** — live curl PoCs for F-GUI-01, F-SERVER-01, F-SERVER-04, F-SERVER-08, F-STORAGE-01/04. Deno PoCs for F-CRYPTO-01 and F-CRYPTO-02. ([[phase-08-dynamic]])
9. **Final report** — this document.

Tools used: `deno lint`, `deno test`, `deno check`, `npm audit`, `cargo audit`, manual secret-scan via `rg`, custom Deno PoC scripts, curl. Tools recommended-but-not-run due to environment: `gitleaks` (full git-history scan), `radamsa` (mutation fuzzing), Burp/ZAP (web-pentest of website verifier).

## Findings by component

### Cryptographic core (core/)

11 findings. **2 High** (F-CRYPTO-01, F-CRYPTO-02), **4 Medium**, **3 Low**, **2 Informational**. Both High findings are confirmed by runnable PoCs. Detail in [[phase-02-crypto-core]].

The core's biggest design issue is that **EBP's encrypted-then-signed payload format does not cryptographically bind sender to recipient.** This is the textbook Don Davis 2001 "Surreptitious Forwarding" attack. A user who decrypts an encrypted-signed message has no way to know whether the sender intended *them* as the recipient. Fix: include `recipientFingerprint` inside the signed envelope.

Secondary issue: **emergency revocation certificates re-use nonce 0**, which is identical to the pre-key-substitution starting nonce of the identity's regular revocation. If an attacker (or even an honest user) issues any regular revocation first, the emergency cert is silently invalidated.

### Server (server/)

12 findings, **3 High**, **5 Medium**, **2 Low**, **2 Informational**. Master branch is build-broken (F-SERVER-13). Detail in [[phase-03-server]].

Reflected XSS, unauthenticated proposal deletion, and `X-Forwarded-For` trust are the actionable highs. CORS, CSP, and security-header hygiene need a single small middleware addition. The Dockerfile runs as root.

### GUI local backend (gui/local-backend/)

12 findings, **1 Critical**, **0 High**, **5 Medium**, **5 Low**, **1 conditional High** (F-GUI-05, downgraded after Phase 6 audit). Detail in [[phase-04-gui]].

The single most important finding in the entire audit. The local backend ships **CORS `*`, no Host validation, no CSRF token** and exposes endpoints that read identity material, write files, and initiate OAuth flows. Confirmed live.

### CLI (cli/)

6 findings, **1 High** (F-CLI-01: terminal echo on password), **2 Medium**, **2 Low**, **1 Informational**. Detail in [[phase-05-cli-website-tauri]].

### Website verifier (website/)

4 findings, **0 High**, **3 Medium**, **1 Low**. The verifier defers to the server's `verified` boolean — a trust placement the project's threat model does not actually warrant.

### Tauri shell (desktop/src-tauri/)

5 findings, **2 High** (F-TAURI-01, F-TAURI-02), **1 Medium**, **1 Low**, **1 Informational**. Migration to Tauri 2.x resolves the highs structurally.

### Supply chain & build

10 findings, **1 High** (F-DEP-02: Tauri 1.x crate vulnerabilities), **2 Medium**, **3 Low**, **4 Informational**. No committed secrets observed.

### Identity storage

11 findings, **1 High** (F-STORAGE-01: world-readable identity files), **3 Medium**, **6 Low**, **1 Informational**.

## Adversary-by-adversary risk

From the [[threat-model]] adversary matrix:

| Adversary | What they can do today | Mitigated by |
|---|---|---|
| **Network attacker (between client and server)** | MITM of HTTP server URL (F-CLI-03), token-in-URL leakage (F-SERVER-09), no HSTS preload | TLS in production, lock down `http://` server URLs |
| **Malicious server operator** | Lie about `verified: true` to the website verifier (F-WEB-01); enumerate identities (F-SERVER-08); silently consume nonces | Move verification client-side (F-WEB-01 fix); identity enumeration is partial public-key cryptosystem property |
| **Malicious browser tab adjacent to GUI** | F-GUI-01: read identities, contacts, mail accounts; write `~/Downloads/`; pre-stage OAuth attacks. Plus F-TAURI-01 (open arbitrary scheme handlers). | Per-launch CSRF token + Host validation + scoped CORS |
| **Malicious contact / payload author** | F-CRYPTO-02: surreptitious forward; F-GUI-05/F-DEP-01 conditional via mailparser CVE chain | Encrypt-then-sign or recipient-binding; bump nodemailer |
| **Local attacker with disk read** | F-STORAGE-01 + F-STORAGE-02: offline brute-force of 8-char passwords in days on GPUs; emergency cert export at 0644 | 0o600 perms + 600k PBKDF2 (or Argon2id) + 12-char password floor |
| **Compromised dependency** | F-DEP-02 Tauri 1.x crates (tar, rand); F-DEP-01 nodemailer | Tauri 2.x migration; npm audit fix |
| **Supply-chain attacker (release bin)** | No reproducible build (F-SUPPLY-01); appimagetool downloaded from `continuous` tag (F-BUILD-01) | SHA-256 checksum pinning + reproducible-build investment |

## What EBP gets right (worth preserving)

- **Cryptographic primitives** — `@noble/post-quantum` for FIPS-203/204/205, `@noble/ciphers` for AES-GCM, `@noble/hashes` for PBKDF2 + SHA-256. CSPRNG everywhere. No `Math.random` in security-sensitive paths.
- **Lockfile-pinned URL imports** — every `https://deno.land/x/...` import has a SHA-256 in `deno.lock`.
- **HTML mail rendering** — sandboxed iframe (`sandbox=""`) plus `default-src 'none'` CSP. Robust XSS containment.
- **Frontend `escapeHtml`** — consistently applied at `innerHTML` sinks throughout `gui/js/*`.
- **AEAD throughout** — AES-256-GCM with random IVs and 128-bit salts.
- **Bech32 fingerprints with HRP separation** — `ebpdk` vs `ebpsk` cleanly distinguishes signing vs encryption keys.
- **Per-identity Merkle-rooted fingerprints** — designed for incremental detail proofs.
- **State signatures** — every mutation includes a state-hash transition signature (defense against silent substitution).
- **Rate limiting + body-size caps on the public server** — present and consistent.

## Residual risk and gaps

- **Out-of-scope code** — `mobile/` and `email/` (Chrome extension) were not reviewed. The Chrome extension in particular interacts with the GUI local backend and may be the *intended* consumer of the cross-origin design that became F-GUI-01; that hypothesis needs validation.
- **Server master branch was build-broken** — F-SERVER-01 was confirmed live only with a temporary local patch (reverted); some server findings remain static-only.
- **No formal fuzzing harness was run** — recommended next step.
- **No `gitleaks` historical scan** — rely on the manual `rg` scan, which is shallow.
- **No crypto-protocol formal verification** — the F-CRYPTO-02 surreptitious-forwarding risk would have been caught by ProVerif / Tamarin-style symbolic analysis.

## Appendix A — Roadmap

### Week-1 (immediate)

- [ ] Add per-launch CSRF token in GUI local backend; restrict CORS; validate Host. (F-GUI-01)
- [ ] HTML-escape `token` in `verify-email.ts`. (F-SERVER-01)
- [ ] Apply `mode: 0o600` to all identity-file writes; `mode: 0o700` to `~/.ebp/`. (F-STORAGE-01, F-STORAGE-04)
- [ ] Fix `./db.ts` → `./db/index.ts` import in 7 server files. (F-SERVER-13)
- [ ] Add `USER deno` to `Dockerfile`. (F-SERVER-05)
- [ ] `npm audit fix`. (F-DEP-01)
- [ ] Disable terminal echo in `cli/utils.ts:readPassword`. (F-CLI-01)

### Month-1

- [ ] Recipient-bind encrypted-signed payloads (F-CRYPTO-02); add UI indicator (F-GUI-07).
- [ ] Emergency-cert nonce space separation (F-CRYPTO-01).
- [ ] Sign-required hierarchy/reject endpoint (F-SERVER-02).
- [ ] Restrict `getClientIp` `X-Forwarded-For` to `TRUST_PROXY` mode (F-SERVER-03).
- [ ] Add CSP, X-Content-Type-Options, Referrer-Policy headers to server responses (F-SERVER-04 part 2).
- [ ] Bump PBKDF2 to 600k iterations with storage version bump (F-STORAGE-02).
- [ ] Domain-separate signature envelopes (F-CRYPTO-03).
- [ ] Canonical JSON across detail-proof / revocation-cert signing payloads (F-CRYPTO-05).
- [ ] Set `PRAGMA foreign_keys = ON` in SQLite adapter (F-SERVER-06).
- [ ] Emergency-cert export at `0o600` (F-STORAGE-06).

### Quarter-1

- [ ] Migrate to **Tauri 2.x** — resolves F-DEP-02, F-TAURI-01, F-TAURI-02, and modernises the entire desktop stack.
- [ ] Migrate to Argon2id KDF (F-STORAGE-02 long-term).
- [ ] Implement client-side signature verification in `website/verify.js` (F-WEB-01) and add CSP (F-WEB-03).
- [ ] Reproducible-build investment (F-SUPPLY-01).
- [ ] Move `deno.land/std@0.224.0` and `deno.land/x/...` to JSR equivalents (F-DEP-03, F-DEP-04).
- [ ] Establish a release-asset signing/checksum workflow distinct from GitHub release-asset trust.
- [ ] Add per-action OS-native confirmation dialogs (Tauri `dialog.ask`) for `/api/v1/sign` (F-GUI-06).
- [ ] Formal verification (ProVerif/Tamarin) of the encrypt-and-sign protocol post-fix.

### Backlog / longer-term

- [ ] Argon2id with per-platform parameter tuning.
- [ ] Hardware-key-wrapped storage on platforms that support it (Touch ID, Windows Hello, TPM).
- [ ] Differential fuzzing harness for `verify-signature`.
- [ ] CI integration of `cargo audit`, `npm audit`, `deno lint`, `gitleaks`.
- [ ] Threat-model maintenance: update on every protocol change.

## Appendix B — Audit artifacts

- [[README]] — audit index page.
- [[threat-model]] — assets, adversaries, trust boundaries, STRIDE.
- [[findings]] — full findings register (75 entries).
- [[phase-01-scaffolding]], [[phase-02-crypto-core]], [[phase-03-server]], [[phase-04-gui]], [[phase-05-cli-website-tauri]], [[phase-06-supply-chain]], [[phase-07-storage]], [[phase-08-dynamic]] — phase notes.
- `pocs/F-CRYPTO-01-emergency-nonce-collision.ts` — Deno PoC, runnable.
- `pocs/F-CRYPTO-02-surreptitious-forwarding.ts` — Deno PoC, runnable.
- `pocs/F-SERVER-01-verify-email-xss.sh` — bash PoC.
- `pocs/F-SERVER-02-hierarchy-reject-dos.sh` — bash PoC.
- `pocs/F-GUI-01-cross-origin-csrf.html` — browser PoC.
- `pocs/F-STORAGE-01-perms.ts` — Deno PoC, runnable, confirmed.
- `tooling-output/phase-02-deno-lint.txt`
- `tooling-output/phase-02-deno-test-core.txt`
- `tooling-output/phase-04-deno-lint-gui-backend.txt`
- `tooling-output/phase-06-npm-audit.txt`, `.json`
- `tooling-output/phase-06-cargo-audit.txt`
- `tooling-output/phase-08-storage-perms.txt` — F-STORAGE-01/04 live confirmation.
- `tooling-output/phase-08-F-GUI-01-live.txt` — F-GUI-01 live confirmation.
- `tooling-output/phase-08-F-SERVER-01-live.html` — F-SERVER-01 live confirmation.

## Appendix C — Acknowledgements & limitations

This audit was conducted in a single pass by a single reviewer over the source tree at master HEAD on 2026-04-18. No source modifications were committed; temporary patches used for dynamic testing of the build-broken server were reverted. Time and tooling limitations meant fuzzing and formal protocol verification were deferred to roadmap. Findings should be triaged independently by the project maintainer; CVSS scores and severity classifications are advisory and reflect the EBP-specific environmental considerations described in [[threat-model]].

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[index.md|Wiki Index]]
