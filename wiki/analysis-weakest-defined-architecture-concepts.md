---
title: "Weakest-Defined Concepts in EBP Architecture"
type: analysis
status: active
last_updated: 2026-05-06
source_count: 6
tags:
  - analysis
  - architecture
  - gaps
  - roadmap
---

# Weakest-Defined Concepts in EBP Architecture

This page identifies architecture concepts that are currently least defined in the wiki, based on four signals:

1. page maturity (`status: seed`),
2. source depth (`source_count` and specificity),
3. implementation specificity (clear variants, APIs, workflows),
4. roadmap-only mentions without dedicated concept pages.

## Ranking (weakest to stronger)

### 1) FN-DSA integration model (weakest-defined)

[[fn-dsa]] is explicitly marked planned and `seed`, with `source_count: 1`. It lacks concrete EBP integration commitments such as final variant selection, key/signature encoding details, compatibility/versioning impacts, migration plan, and server/client handling semantics.

Current wiki language confirms this is still conceptual ("Not yet implemented", variant "TBD"), so this remains the thinnest-defined cryptographic architecture surface.

### 2) Mobile architecture boundary and parity contract

[[component-mobile]] is also `seed` with `source_count: 1`. It states feature parity intent with the GUI, but does not define:

- parity scope by capability,
- data synchronization and conflict model,
- offline/security posture relative to GUI/CLI,
- protocol/API contracts and versioning expectations.

The page includes one concrete normalization detail but lacks an explicit architecture contract for what "parity" means over time.

### 3) Roadmap concepts with no canonical concept pages

[[overview]] lists future-facing concepts, but several still have no dedicated pages in `wiki/`:

- ENS integration for fingerprint lookup
- identity hierarchy (master/cold/hot chain model)
- identity expiry dates
- hashed/opaque detail endorsement — status and build plan now in
  [[analysis-opaque-detail-endorsement]] (cleartext email endorsement works;
  opaque path endorsement does not)

These are architecture-relevant ideas currently defined only as bullets, without threat model boundaries, protocol fields, state transitions, or implementation decomposition.

### 4) Desktop component provenance (definition-vs-evidence gap)

[[component-desktop]] has strong descriptive architecture detail, but remains `seed` with `source_count: 0`, relying on linked wiki analyses/pages rather than direct code/source citations in the frontmatter count. The concept is moderately defined in narrative terms, but weaker in explicit source-backed grounding than other active component pages.

## Contrast: Well-defined anchors

For comparison, [[identity-model]] and [[revocation-system]] are `active` with detailed workflows, structures, and implementation references. They serve as stronger architecture anchors than the concepts above.

## Implications

- Architecture risk is concentrated in future/expanding surfaces (FN-DSA, mobile parity, hierarchy/expiry/lookup roadmap items), not in current identity/revocation fundamentals.
- The largest quality gain would come from converting roadmap bullets into dedicated concept pages with explicit invariants and interface boundaries.

## Sources

- [[index]]
- [[overview]]
- [[fn-dsa]]
- [[component-mobile]]
- [[component-desktop]]
- [[identity-model]]
- [[revocation-system]]
