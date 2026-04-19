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
| F-CRYPTO-01 | High | core | Emergency revocation certificate uses nonce 0 which collides with first regular revocation, silently consuming the emergency slot | open |
| F-CRYPTO-02 | High | core | Surreptitious forwarding: signed-then-encrypted payload does not bind sender to recipient (Davis 2001) | open |
| F-CRYPTO-03 | Medium | core | Signature envelope lacks per-purpose domain separation (single `ebp::messagehash::` envelope reused across messages, detail proofs, revocations) | open |
| F-CRYPTO-04 | Medium | core | Fingerprint leaf hashing is inconsistent: signing leaf hashes decoded bytes while encryption leaf hashes hex-string bytes | open |
| F-CRYPTO-05 | Medium | core | Detail-proof and revocation-cert signing payloads rely on `JSON.stringify` insertion-order rather than canonical JSON | open |
| F-CRYPTO-06 | Medium | core | `Identity.fromStorageFormat` constructs Identity via `Object.create` bypassing constructor invariants; later signing on public-only instance fails opaquely | open |
| F-CRYPTO-07 | Low | core | Hierarchy certificate signing payload uses `::` joining over user-supplied `context` field; not a parser-secure encoding | open |
| F-CRYPTO-08 | Low | core | `Hex.hexToBytes` accepts any character via `parseInt(_, 16)` rather than validating `[0-9a-fA-F]` (NaN bytes become 0) | open |
| F-CRYPTO-09 | Low | core | `Identity.signAndEncryptMessage` builds inner JSON `{message, signature}` with no version/type tag — parser ambiguity | open |
| F-CRYPTO-10 | Informational | core | `MAX_CONTEXT_LENGTH` for hierarchy is 256 chars but no length cap on `reason` strings in revocation certs | open |
| F-CRYPTO-11 | Informational | core | `PROTOCOL_VERSION` is `0.0.1` and `isProtocolVersionSupported` only compares major+minor — patch ignored | open |
| F-SERVER-01 | High | server | Reflected XSS in `GET /api/v1/verify-email` — token query param interpolated unescaped into HTML response | open |
| F-SERVER-02 | High | server | Unauthenticated deletion of pending hierarchy proposals: `POST /api/v1/hierarchy/reject` requires no signature, only a fingerprint that is part of the proposal | open |
| F-SERVER-03 | High | server | `getClientIp` blindly trusts `X-Forwarded-For`; rate-limit bypass and log forgery on any deployment without a strict reverse proxy | open |
| F-SERVER-04 | Medium | server | Default `ALLOWED_ORIGINS=*`, no Host validation, no CSP, no `X-Content-Type-Options`, no `Referrer-Policy` | open |
| F-SERVER-05 | High | server | Dockerfile runs as root (no `USER` directive) — broader blast radius for any RCE | open |
| F-SERVER-06 | Medium | server | SQLite adapter does not set `PRAGMA foreign_keys = ON`; declared FK constraints are advisory | open |
| F-SERVER-07 | Medium | server | Search `LIKE %query%` does not escape `%`/`_`; attacker-controlled wildcards force expensive scans | open |
| F-SERVER-08 | Medium | server | Identity-existence enumeration via registration response codes (200 vs 400 vs 404) | open |
| F-SERVER-09 | Medium | server | Email-verification token transmitted in URL — leaks via access logs, browser history, future Referer headers | open |
| F-SERVER-10 | Low | server | Email-verification fallback compares plaintext token via SQL `=`; not constant-time. Mitigated by `EMAIL_VERIFICATION_STORE_PLAINTEXT=false` default | open |
| F-SERVER-11 | Informational | server | `computeSigningRawFingerprint` invoked only for side-effect of throwing on bad keys; explicit `validatePostQuantumKey` would be clearer | open |
| F-SERVER-13 | Low | server | Server `main.ts` references non-existent `./db.ts`; `deno check server/main.ts` fails. Repo is in build-broken state on master | open |

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
