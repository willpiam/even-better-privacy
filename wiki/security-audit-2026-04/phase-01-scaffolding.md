---
title: "Phase 1 — Scaffolding & Threat Model"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-1
---

# Phase 1 — Scaffolding & Threat Model

Part of the April 2026 [[README|EBP Security Audit]].

## Activities

1. Created the `wiki/security-audit-2026-04/` audit folder with `pocs/` and `tooling-output/` subdirectories.
2. Authored:
   - [[README]] — audit index and methodology summary.
   - [[threat-model]] — assets, adversary capability matrix, STRIDE per component, trust-boundary diagram.
   - [[findings]] — findings register seeded with preliminary cryptographic findings observed during pre-read.
3. Established naming and severity conventions.

## Trust-boundary highlights

- B1 (browser ↔ `127.0.0.1:8787`) and B5 (Tauri loader race) are the two highest-risk client-side surfaces.
- B4 (server ↔ Internet) is the canonical public attack surface but is small and deliberate.
- B2 (local backend ↔ disk) gives the GUI ambient filesystem authority because of `--allow-read --allow-write --allow-run --allow-sys` in [`deno.json`](../../deno.json).

## Preliminary findings raised in Phase 1

These were observed during the cursory crypto-core pre-read needed to build the threat model. They are formally analyzed in Phase 2.

- F-CRYPTO-01 — Emergency revocation cert nonce-0 collision.
- F-CRYPTO-02 — Surreptitious forwarding (Davis 2001) on encrypt+sign.
- F-CRYPTO-03 — Signature envelope lacks per-purpose domain separation.

## Hand-off to Phase 2

Phase 2 covers the cryptographic core in [`core/`](../../core). The pre-read is already done; Phase 2 will deepen the analysis, add PoCs for the High-severity findings, and run static checks.

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[phase-02-crypto-core]]
