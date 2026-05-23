---
title: "HQC — NIST Backup KEM"
type: entity
status: active
last_updated: 2026-05-20
source_count: 1
tags:
  - crypto
  - kem
  - codes
  - nist
  - standards
  - not-implemented
---

# HQC (Hamming Quasi-Cyclic) — NIST Backup KEM

**HQC** is NIST's selected **backup** key-encapsulation mechanism for general encryption, announced March 11, 2025. It is intended to complement—not replace—[[ml-kem|ML-KEM]] (FIPS 203). See [[source-nist-hqc-fifth-pq-encryption]] for the announcement summary.

## Status in EBP

**Not implemented.** EBP confidentiality workflows use **ML-KEM-1024** exclusively. No HQC code, parameter profiles, or identity HRPs exist in the repository.

## NIST role and timeline

| Aspect | Detail |
|---|---|
| Primary KEM | ML-KEM (FIPS 203) — remain the recommended migration target |
| Backup KEM | HQC — fallback if ML-KEM is ever broken |
| Math family | Error-correcting codes (vs ML-KEM's structured lattices) |
| Round | Sole round-4 selection for standardization |
| Draft standard | Expected ~2026 (about one year after March 2025 announcement) |
| Final standard | Target **2027** after 90-day public comment |

## Why a second KEM matters (standards context)

NIST's stated goal is **cryptographic diversity** for confidentiality: if future cryptanalysis or quantum advances undermine lattice KEMs, a code-based backup standard can still protect new encapsulations. This parallels EBP's dual **signing** options ([[ml-dsa]] lattice vs [[slh-dsa]] hash-only), but at the **encryption** layer NIST is standardizing two KEM families while EBP currently deploys only one.

## Relationship to ML-KEM

Both algorithms are **KEMs**—they establish a shared secret for downstream symmetric encryption (in EBP, AES-256-GCM after encapsulation). NIST draft guidance on KEM definitions and secure use appears in SP 800-227 ([[source-nist-hqc-fifth-pq-encryption]] cites the March 2025 draft).

If EBP ever adopted HQC, integration would likely follow the same encapsulate → AES-GCM pattern as [[ml-kem]], but would require new parameter sizes, fingerprint leaf hashing rules, and cross-language test vectors once a FIPS is published. **Unclear from the announcement** which HQC parameter set(s) the future standard will mandate.

## Related Pages

- [[source-nist-hqc-fifth-pq-encryption]]
- [[ml-kem]]
- [[source-fips-203]]
- [[message-payload-formats]]
- [[openpgp-pqc]]
- [[cryptographic-algorithm-transitions]]
- [[overview]]

## Sources

- `wiki/raw/NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption.md` → [[source-nist-hqc-fifth-pq-encryption]]
