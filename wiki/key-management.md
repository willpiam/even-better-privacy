---
title: "Key Management Context"
type: concept
status: active
last_updated: 2026-04-30
source_count: 4
tags:
  - key-management
  - lifecycle
  - revocation
  - policy
---

# Key Management Context

Key management covers the lifecycle of keying material: generation, storage, distribution, use, rotation, revocation, compromise handling, backup, recovery, and destruction. NIST SP 800-57 is the main source family currently summarized in the wiki for this topic.

## Source Roles

- [[source-sp-800-57-part-1-r5]] gives general lifecycle guidance, key states, cryptoperiod concepts, and security-strength planning.
- [[source-sp-800-57-part-2-r1]] covers organizational policy and cryptographic key management systems.
- [[source-sp-800-57-part-3-r1]] gives application-specific guidance for domains such as PKI, TLS, S/MIME, DNSSEC, and SSH, with a staleness caution for modern protocol choices.

## EBP Touchpoints

EBP's [[identity-model]] and [[revocation-system]] are the main project-specific key-management surfaces:

- Private signing and encryption keys are stored separately from public identity data.
- Revocation certificates handle detail and whole-identity invalidation.
- Emergency revocation certificates are a recovery mechanism for loss or compromise scenarios.
- Future identity expiry, rotation, and hierarchy features should be documented with explicit key-state and cryptoperiod assumptions.
- Long-lived signature evidence should incorporate [[integrity-renewal]] practices so signatures remain verifiable across hash/algorithm transitions.

## Boundary

The NIST sources provide vocabulary and risk-management structure. They do not make EBP a federal CKMS, and they do not replace the project-specific protocol and storage documentation.

## Related Pages

- [[source-sp-800-57-part-1-r5]]
- [[source-sp-800-57-part-2-r1]]
- [[source-sp-800-57-part-3-r1]]
- [[identity-model]]
- [[revocation-system]]
- [[cryptographic-algorithm-transitions]]
- [[integrity-renewal]]

## Sources

- `wiki/raw/NIST.SP.800-57pt1r5.pdf` → [[source-sp-800-57-part-1-r5]]
- `wiki/raw/NIST.SP.800-57pt2r1.pdf` → [[source-sp-800-57-part-2-r1]]
- `wiki/raw/NIST.SP.800-57Pt3r1.pdf` → [[source-sp-800-57-part-3-r1]]
- `wiki/raw/Long-lived-digital-integrity-using-short-lived-hash-functions.pdf` → [[source-long-lived-digital-integrity-using-short-lived-hash-functions]]
