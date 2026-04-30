---
name: audit-findings-above-foo
overview: Plan to remediate the seven open audit findings above the foo(x)=8 ease threshold from plot_remaining_findings.py, grouped by component (gui-local-backend, core, website, tauri) and sequenced by risk and parallelizability.
todos:
  - id: wave1-gui
    content: "Wave 1: Close Group A — F-GUI-08 body-size cap, F-GUI-10 OAuth-map cap+rate-limit, F-GUI-02 refuse-overwrite save-file"
    status: completed
  - id: wave2-core-web
    content: "Wave 2: Close Group B (F-CRYPTO-06 constructor invariants, F-CRYPTO-04 fingerprint leaf canonicalization) and Group C (F-WEB-04 verifier paste validation)"
    status: completed
  - id: wave3-tauri
    content: "Wave 3: Close Group D — F-TAURI-05 sidecar log file mode 0o600"
    status: completed
  - id: finalize-rerun
    content: Update findings.md statuses, prune stale ranking heuristics if applicable, rerun plot_remaining_findings.py, log the batch in wiki/log.md
    status: completed
isProject: false
---

# Plan: Address Audit Findings Above foo

## Scope and Threshold

- foo definition: horizontal line `foo(x) = 8` overlaid on the (severity_score, ease_score) scatter in [plot_remaining_findings.py](plot_remaining_findings.py) (lines 281-283). "Above foo" means `ease_score > 8`. Because `rank_to_unique_scores` evenly spaces 32 open findings across 0..10 (`score = 10.0 * (1 - idx/(n-1))`), only the top 7 by ranked ease (idx 0..6 → ease_score 10.00, 9.68, 9.35, 9.03, 8.71, 8.39, 8.06) clear the line.
- included findings count: 7
- excluded findings count: 25 (open findings with ease_score ≤ 8)

Top-7 set, with raw_ease tie-broken by `(raw_ease, severity, component, title, finding_id)` descending in [plot_remaining_findings.py](plot_remaining_findings.py) lines 166-188:

- F-GUI-08 (Medium, gui-local-backend) — `readJson` has no body-size cap; cross-origin OOM via streaming megabodies. Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 60.
- F-GUI-10 (Medium, gui-local-backend) — `mailOauthStarts` Map can be flooded cross-origin to exhaust memory. Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 62.
- F-GUI-02 (Medium, gui-local-backend) — `/api/v1/save-file` overwrites existing files in `~/Downloads/` without confirmation. Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 54.
- F-CRYPTO-06 (Medium, core) — `Identity.fromStorageFormat` constructs `Identity` via `Object.create`, bypassing constructor invariants. Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 35.
- F-CRYPTO-04 (Medium, core) — Fingerprint leaf hashing inconsistency (signing leaf hashes decoded bytes; encryption leaf hashes hex-string bytes). Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 33.
- F-WEB-04 (Low, website) — `JSON.parse` on attacker-pasted content (mitigated by V8/SpiderMonkey safe `__proto__` handling). Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 74.
- F-TAURI-05 (Low, tauri) — Sidecar log file created with default permissions (0644). Source: [wiki/security-audit-2026-04/findings.md](wiki/security-audit-2026-04/findings.md) line 79.

Assumptions (call out explicitly):

- "Above foo" is interpreted strictly (`>`, not `>=`); the line itself is the threshold per the plot semantics.
- The current 32-item open count is taken from the live [findings.md](wiki/security-audit-2026-04/findings.md). If new findings are appended before remediation, the ranked set must be recomputed.

## Grouped Findings

### Group A — gui-local-backend (Medium cluster)

- Findings: F-GUI-08, F-GUI-10, F-GUI-02
- Remediation type(s): code fix (HTTP body input cap); code fix (in-memory map cap + rate limit); code fix (refuse-overwrite write semantics).
- Why this group matters: All three are exploitable from any cross-origin caller that reaches `127.0.0.1:8787` (post F-GUI-01 the strict CSRF token gates this, but DoS and overwrite are still in-process risks for any local caller). They share one file family ([`gui/local-backend/http.ts`](gui/local-backend/http.ts) and [`gui/local-backend/routes.ts`](gui/local-backend/routes.ts)) so they batch cleanly. See [wiki/security-audit-2026-04/phase-04-gui.md](wiki/security-audit-2026-04/phase-04-gui.md) (sections F-GUI-02 lines 89-99, F-GUI-08 lines 138-144, F-GUI-10 lines 150-154).

### Group B — core (Medium cluster)

- Findings: F-CRYPTO-06, F-CRYPTO-04
- Remediation type(s): code fix (constructor-respecting deserializer); code fix (canonical fingerprint-leaf hashing rule).
- Why this group matters: Both are correctness bugs in the identity/fingerprint layer — silent class of issue that can yield mismatched fingerprints or runtime-only signing failures. F-CRYPTO-04 is a cross-key-type asymmetry; F-CRYPTO-06 weakens object invariants downstream of `Identity` deserialization.

### Group C — website (Low, defense-in-depth)

- Findings: F-WEB-04
- Remediation type(s): code fix (input validation around `JSON.parse` of attacker-pasted blobs).
- Why this group matters: Strictly defense-in-depth; current browser engines neutralize the `__proto__` vector. Closing it removes a future-engine assumption.

### Group D — tauri (Low, defense-in-depth)

- Findings: F-TAURI-05
- Remediation type(s): code fix (open log file with `0o600`; or umask the parent at sidecar boot).
- Why this group matters: Local-multi-user systems leak sidecar logs to other users at `0644`. Trivial to fix by setting file mode on creation.

Owner suggestions: TBD across groups — the GUI Group A is naturally one owner; Group B fits the crypto-core owner; Groups C and D fit the desktop/website owner.

## Execution Plan

### Wave 1

- Group(s): Group A — gui-local-backend Medium cluster.
- Actions:
  - F-GUI-08: introduce `MAX_BODY_SIZE` in [`gui/local-backend/http.ts`](gui/local-backend/http.ts) `readJson`, mirroring the `server/body.ts` pattern; reject with 413 above the cap before parsing.
  - F-GUI-10: in [`gui/local-backend/routes.ts`](gui/local-backend/routes.ts) `mailOauthStarts` (line ~133), enforce a max-size cap on the Map, expire entries on a TTL, and rate-limit `POST /api/v1/mail/oauth/start` per origin/IP.
  - F-GUI-02: in [`gui/local-backend/routes.ts`](gui/local-backend/routes.ts) `/api/v1/save-file` handler (line ~2799), refuse if file exists or auto-suffix (`name (1).ext`); when running under Tauri, route through `dialog.save`.
- Validation: unit tests for body-cap rejection, OAuth Map eviction, save-file existence-collision; integration test that exercises cross-origin call shapes.
- Exit criteria: three findings move to `fixed (YYYY-MM-DD)` in [findings.md](wiki/security-audit-2026-04/findings.md); CI green on `deno task test`.

### Wave 2

- Group(s): Group B — core crypto correctness; Group C — website defense-in-depth.
- Actions:
  - F-CRYPTO-06: replace `Object.create(...)` in `Identity.fromStorageFormat` with a real constructor path that enforces the public/private invariants; throw early when private state is loaded into a public-only branch.
  - F-CRYPTO-04: pick one canonical leaf-hashing rule for the fingerprint Merkle tree (decoded-bytes vs hex-string) and align both signing and encryption leaves to it; add a regression test that hashes a fixed identity and pins the output.
  - F-WEB-04: in the website verifier's paste handler, validate the parsed structure (expected fields, types) before use; keep the `try/catch` and treat parse failures as user-facing errors.
- Validation: existing crypto-core test suite; add a fingerprint-stability vector to lock the post-fix output; add a verifier unit test for malformed JSON paste input.
- Exit criteria: F-CRYPTO-06, F-CRYPTO-04, F-WEB-04 marked `fixed`; fingerprint vector pinned and documented in the relevant phase or component page.

### Wave 3

- Group(s): Group D — tauri sidecar log permissions.
- Actions:
  - F-TAURI-05: when the sidecar opens its log file, request mode `0o600` (Deno: `Deno.open(path, { create: true, write: true, mode: 0o600 })`) and ensure the parent directory is `0o700`. On Windows, no-op (mode flag ignored).
- Validation: post-launch check that `stat ~/.ebp/<sidecar-log>` shows `0600` on Linux/macOS.
- Exit criteria: F-TAURI-05 marked `fixed`; manual verification on a Linux build documented.

Sequencing rationale: Wave 1 closes Medium-severity, exploitable-DoS and file-overwrite issues that share a file neighborhood and can ship as one PR. Wave 2 is correctness-class crypto work that warrants a dedicated review and fingerprint stability vectors; Group C is bundled because it is a small website edit independent of Group B. Wave 3 is the smallest item and is parked last because it is Low and isolated to packaging.

## Dependencies and Risks

- Dependencies:
  - F-GUI-02 ideally lands after the Tauri 2.x migration completes ([F-DEP-02 closure note](wiki/analysis-top-open-security-issues.md) lines 49-50) so the `dialog.save` path is available; in the meantime ship the refuse-overwrite rule and add the dialog path behind a Tauri capability check.
  - F-CRYPTO-04 changes the fingerprint Merkle leaf hashing rule. If any deployed identity has been published with the current rule, this is a wire-format break; before merging, audit whether the affected tree level is computed only locally or whether it is part of any persisted/published artifact (e.g. signed detail proofs). If wire-format-visible, gate behind a protocol-version bump and migration plan.
- Blockers:
  - F-CRYPTO-04 may block on the canonicalization decision (decoded-bytes vs hex-string) — this is a one-call architectural choice that should be made before coding.
- Risk notes:
  - F-GUI-10 rate limiting needs care so legitimate retry flows (mail OAuth re-try after user error) are not throttled out.
  - F-CRYPTO-06 must not silently change the public Identity API surface; tests that rely on duck-typed instances may need updating.

## Finalization

- The `plot_remaining_findings.py` script does not maintain a hardcoded "solved" list — it filters dynamically on the `open` status field in [findings.md](wiki/security-audit-2026-04/findings.md) (lines 41-54). Maintenance step is therefore:
  1. Update each remediated row in [findings.md](wiki/security-audit-2026-04/findings.md) to `fixed (YYYY-MM-DD)`.
  2. Optionally prune now-stale heuristic patterns in `severity_raw_score` / `ease_raw_score` (lines 71-89, 112-134) if they only match findings that are now closed; this keeps the ranking signal honest for the next pass.
  3. Rerun `python plot_remaining_findings.py`.
  4. Confirm the regenerated artifact path `wiki/security-audit-2026-04/remaining-findings-plot.png` (per [plot_remaining_findings.py](plot_remaining_findings.py) line 27) and re-evaluate the new above-`foo` set; expect Wave-1 items first to drop out, surfacing the next ranked tier (currently F-CRYPTO-07/08, F-GUI-04/07/09/11, F-DOCKER-01, F-STORAGE-03/05/08).
  5. Append a wiki log entry to [wiki/log.md](wiki/log.md) noting the closure batch and the rerun.
