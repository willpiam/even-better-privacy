---
title: "EBP Security Audit — April 2026"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - 2026-04
---

# EBP Security Audit — April 2026

A phased, defense-in-depth security audit of EBP combining manual code review, automated tooling, and dynamic testing.

## Scope

In scope: [`core/`](../../core), [`cli/`](../../cli), [`server/`](../../server), [`gui/`](../../gui) (frontend + [`gui/local-backend/`](../../gui/local-backend)), [`desktop/`](../../desktop) (Tauri shell), [`website/`](../../website), [`scripts/`](../../scripts), [`Dockerfile`](../../Dockerfile), Deno/npm/Cargo manifests and lockfiles, build scripts, identity storage on disk (`~/.ebp/`), and the wire formats in [`core/Payloads.ts`](../../core/Payloads.ts).

Out of scope (per requestor): [`mobile/`](../../mobile), [`email/`](../../email) (Chrome extension). Note: the localhost API surface that the extension consumes (`http://127.0.0.1:8787`) IS in scope because any local origin can hit it.

## Pages

- [[threat-model]] — assets, adversaries, trust boundaries, STRIDE per component.
- [[findings]] — running register of findings (id, severity, status, links).
- [[phase-01-scaffolding]] — Phase 1 notes.
- [[phase-02-crypto-core]] — Phase 2 notes (`core/`).
- [[phase-03-server]] — Phase 3 notes (`server/`).
- [[phase-04-gui]] — Phase 4 notes (`gui/`, `gui/local-backend/`).
- [[phase-05-cli-website-tauri]] — Phase 5 notes (CLI, website verifier, Tauri).
- [[phase-06-supply-chain]] — Phase 6 notes (deps + build).
- [[phase-07-storage]] — Phase 7 notes (`~/.ebp/`, key management).
- [[phase-08-dynamic]] — Phase 8 notes (dynamic testing + PoCs).
- [[report]] — final consolidated report (Phase 9).
- `pocs/` — runnable PoC scripts.
- `tooling-output/` — raw scanner output.

## Methodology

Industry-standard security audits combine four lenses; this audit applies all four:

1. Threat model first (STRIDE per component + adversary capability matrix) so every finding ties to a concrete threat.
2. Manual code review prioritized by trust boundary and blast radius.
3. Automated tooling for known CVEs, secrets, and lint coverage (`deno lint`, `npm audit`, `cargo audit`, `gitleaks`).
4. Dynamic testing: run the system locally, fuzz endpoints, and produce reproducible PoCs.

Findings use the standard severity rubric **Critical / High / Medium / Low / Informational**, scored with **CVSS 3.1** plus contextual notes on exploitability.

## Status

| Phase | Status |
|---|---|
| 1. Scaffolding + threat model | completed |
| 2. Crypto core | completed |
| 3. Server | completed |
| 4. GUI local backend + frontend | completed |
| 5. CLI, website verifier, Tauri | completed |
| 6. Supply chain + build | completed |
| 7. Identity storage | completed |
| 8. Dynamic testing | completed |
| 9. Final report | completed |

## Result

**75 findings** across the codebase. Most severe: **F-GUI-01** (Critical) — universal cross-origin access to the GUI local backend. See [[report]] for the executive summary, prioritised remediation roadmap, and adversary-by-adversary risk analysis. See [[findings]] for the complete findings table.
