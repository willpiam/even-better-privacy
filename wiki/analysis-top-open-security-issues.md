---
title: "Analysis: Top Remaining Open Security Issues (post-2026-04-22 remediation)"
type: analysis
status: needs-review
last_updated: 2026-05-01
source_count: 0
tags:
  - security-audit
  - prioritisation
  - remediation
  - 2026-04
---

# Top Remaining Open Security Issues

A curated, ranked list of the most important **unresolved** findings from the April 2026 security audit ([[security-audit-2026-04/README|Security Audit — April 2026]]), synthesised from the [[security-audit-2026-04/findings|findings register]] and the Appendix-A roadmap in the [[security-audit-2026-04/report|final report]].

> Lint note 2026-05-01: the findings register now records all listed items as fixed by 2026-04-30. This page is retained as a historical closure ledger, but detailed remediation prose below may still use stale "open" wording and needs a focused refresh before being used as current prioritisation.

Remediation cutoff reflected here: **2026-04-22** (the first remediation pass, which closed the Critical F-GUI-01 and most High-severity findings).

## How items were selected

- Only rows with status `open`, `mitigated`, or explicitly "follow-up still open" in [[security-audit-2026-04/findings]].
- Ranked by severity first (High > Medium by impact), then by blast radius and exploitability as described in the report's adversary-by-adversary analysis.
- Already-fixed items (e.g. F-GUI-01, F-CRYPTO-01/02, F-SERVER-01/02/03/05, F-CLI-01, F-TAURI-01, F-STORAGE-01/04, F-WEB-01, F-DEP-01) are intentionally excluded.

## Top 10 remaining issues

Update 2026-04-28: this top-10 set has now been remediated in full. The table
is retained as a closure ledger.

| Rank | ID | Sev | Component | Title | Status |
|---|---|---|---|---|---|
| 1 | F-TAURI-02 | High | tauri | No CSP set on Tauri webview | fixed (2026-04-28) |
| 2 | F-DEP-02 | High | supply-chain | Tauri 1.6 carries RUSTSEC-2026-0067/0068 (`tar`), `rand` unsoundness, 15 unmaintained-crate warnings — full Tauri 2.x migration outstanding | fixed (2026-04-28) |
| 3 | F-GUI-05 | High (cond.) | gui-local-backend | `mailparser` / `imapflow` parse attacker-controlled MIME & IMAP traffic — escalates on any upstream CVE | fixed (2026-04-28) |
| 4 | F-STORAGE-02 | Medium | crypto/storage | Argon2id migration follow-up (PBKDF2 iteration bump already applied) | fixed (2026-04-28) |
| 5 | F-CRYPTO-03 | Medium | core | Signature envelope lacks per-purpose domain separation (single `ebp::messagehash::` envelope reused across messages, detail proofs, revocations) | fixed (2026-04-28) |
| 6 | F-CRYPTO-05 | Medium | core | Detail-proof and revocation-cert signing payloads use `JSON.stringify` insertion-order rather than canonical JSON | fixed (2026-04-28) |
| 7 | F-SERVER-04 | Medium | server | Default `ALLOWED_ORIGINS=*`, no Host validation, no CSP / `X-Content-Type-Options` / `Referrer-Policy` on server responses | fixed (2026-04-28) |
| 8 | F-STORAGE-06 | Medium | storage | Emergency revocation certificate exported with default `0644` — world-readable kill-switch on disk | fixed (2026-04-28) |
| 9 | F-SERVER-09 | Medium | server | Email-verification token transmitted in URL — leaks via access logs, browser history, future Referer headers | fixed (2026-04-28) |
| 10 | F-GUI-06 | Medium | gui-local-backend | `/api/v1/sign` requires only the password — no per-action OS-native confirmation of *what* is being signed | fixed (2026-04-28) |

## Rationale and remediation notes

### 1. F-TAURI-02 — No CSP on Tauri webview (High, open)
The desktop webview still has no CSP. Any JS/content-injection path inside the Tauri frontend has no defensive second layer. Fix is small (add a restrictive CSP meta/header in the Tauri build) and is an immediate win alongside the Tauri 2.x migration. See [[security-audit-2026-04/findings]] row `F-TAURI-02`.

### 2. F-DEP-02 — Tauri 1.x supply chain (High, mitigated)
The shell-open scope was tightened, but the underlying Tauri 1.6 crate tree still carries two live RUSTSEC advisories plus 15 unmaintained-crate warnings. The recommended, durable fix is the **Tauri 2.x migration**, which also structurally resolves F-TAURI-02 via the 2.x permissions/capabilities model. Classified by the report as "week-scale work".

### 3. F-GUI-05 — `mailparser` / `imapflow` attacker-controlled parsing (High cond., open)
Conditional High: its severity depends on upstream CVE discovery. Because it parses attacker-chosen MIME and IMAP traffic inside the GUI local backend, any fresh CVE in these packages is immediately weaponisable. Mitigation path: dependency pinning + rapid-response update policy + consider sandboxing mail parsing behind a worker.

### 4. F-STORAGE-02 — Argon2id migration (Medium, partial fix)
PBKDF2 iterations were bumped in the 2026-04-22 pass, but the report explicitly lists the **Argon2id** migration as the long-term remediation. This protects against GPU-accelerated offline attacks on encrypted identity blobs.

### 5. F-CRYPTO-03 — Domain separation across signature purposes (Medium, open)
One signing envelope (`ebp::messagehash::`) is reused for messages, detail proofs, and revocations. This enables cross-context signature reuse in theoretical attack chains. Fix: per-purpose prefix (e.g. `ebp::message::v1::`, `ebp::detail-proof::v1::`, `ebp::revocation::v1::`).

### 6. F-CRYPTO-05 — Canonical JSON for signed payloads (Medium, open)
Signing relies on `JSON.stringify` insertion order. Any future reordering, polyfill change, or alternate client could silently invalidate signatures or — worse — produce two valid serializations of the same logical payload. Fix: adopt a canonical-JSON serializer for everything signed.

### 7. F-SERVER-04 — Server security headers and CORS default (Medium, open)
`ALLOWED_ORIGINS=*` by default, no `X-Content-Type-Options`, no `Referrer-Policy`, no CSP. Low-effort fix: add a security-headers middleware and change the default to a strict allowlist.

### 8. F-STORAGE-06 — Emergency revocation cert permissions (Medium, open)
Emergency kill-switch material is written `0644`. Fix mirrors the already-applied F-STORAGE-01 remediation: write at `0o600`.

### 9. F-SERVER-09 — Email-verification token in URL (Medium, open)
Tokens in URLs leak via access logs, proxy logs, browser history, and `Referer`. Fix: POST the token or carry it in an `Authorization` header; keep URLs token-free.

### 10. F-GUI-06 — Signing lacks per-action OS confirmation (Medium, open)
Any caller that has the password can invoke `/api/v1/sign` with arbitrary content. With F-GUI-01 closed this is no longer cross-origin-reachable, but a local malicious process can still silently sign on the user's behalf. Fix: native OS prompt (Tauri `dialog.ask`) showing what is being signed.

## Honourable mentions (still open, medium/low — track but not top 10)

Update 2026-04-29: the at-or-above-`foo(x)=8` remediation batch closed
additional mentions (`F-WEB-03`, `F-SERVER-08`, `F-GUI-03`, `F-STORAGE-09`,
`F-SERVER-13`, `F-CLI-04`, `F-CLI-06`, `F-STORAGE-11`, and `F-CRYPTO-11`).
Remaining open mentions are:

- `F-CRYPTO-04` — Fingerprint leaf hashing inconsistency (signing leaf hashes decoded bytes, encryption leaf hashes hex-string bytes).
- `F-CRYPTO-06` — `Identity.fromStorageFormat` uses `Object.create`, bypassing constructor invariants.
- `F-GUI-02` — `/api/v1/save-file` overwrites existing files without confirmation.
- `F-GUI-08` — `readJson` has no body-size cap (DoS).
- `F-GUI-10` — `mailOauthStarts` Map can be flooded.
- `F-TAURI-03` — Sidecar resolution falls back to PATH-like locations.
- `F-BUILD-01` — `appimagetool` downloaded from `continuous` without checksum pinning.
- `F-STORAGE-05` / `F-STORAGE-10` — `state.json` written `0644` and unauthenticated.

Full table: [[security-audit-2026-04/findings]].

## Suggested next sprint

A minimal, high-leverage batch that closes one High and three Mediums in roughly one engineering week:

1. Add a strict CSP to the Tauri webview (F-TAURI-02).
2. Tighten default `ALLOWED_ORIGINS` + add security headers middleware on the server (F-SERVER-04).
3. Domain-separate signature envelopes + canonical JSON for signed payloads (F-CRYPTO-03 + F-CRYPTO-05) — same module, bundled change.
4. Move email-verification token out of the URL (F-SERVER-09).

Tauri 2.x migration (F-DEP-02) is the single largest follow-on investment; schedule separately.

## Related Pages

- [[security-audit-2026-04/README]]
- [[security-audit-2026-04/findings]]
- [[security-audit-2026-04/report]]
- [[security-audit-2026-04/threat-model]]

## Sources

- `wiki/security-audit-2026-04/findings.md` (findings register, post-2026-04-22)
- `wiki/security-audit-2026-04/report.md` (Appendix A roadmap, adversary-by-adversary risk)
