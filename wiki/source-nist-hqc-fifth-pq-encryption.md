---
title: "NIST Selects HQC as Fifth PQ Encryption Algorithm"
type: source-summary
status: active
last_updated: 2026-05-20
source_count: 1
tags:
  - source
  - nist
  - hqc
  - kem
  - post-quantum
  - standards
---

# NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption

NIST news announcement (March 11, 2025) selecting **HQC** as a backup general-encryption KEM alongside finalized **ML-KEM** (FIPS 203).

## Summary

- **Role:** HQC is a **backup** KEM for general encryption (stored data and network traffic). **ML-KEM remains NIST's recommended primary** choice; organizations should continue migrating to the standards finalized in 2024 ([[source-fips-203]], [[source-fips-204]], [[source-fips-205]]).
- **Motivation:** A second standard based on **different mathematics** than ML-KEM provides a fallback if structured-lattice attacks weaken ML-KEM in the future.
- **Mathematical basis:** ML-KEM uses **structured lattices**; HQC uses **error-correcting codes** (a long-used information-security construct).
- **Performance:** HQC is **longer / more resource-intensive** than ML-KEM per NIST's project lead, but reviewers judged its operation clean enough for backup use.
- **Standardization path:** NIST plans a **draft HQC standard for public comment in about one year** (from March 2025), a **90-day comment period**, then **finalization targeted for 2027**. Selection rationale is documented in [NIST IR 8545](https://csrc.nist.gov/pubs/ir/8545/final).
- **PQC program context:** HQC is the **only algorithm selected for standardization from NIST round 4** (four candidates were studied). It joins the four algorithms announced in 2022; three are already in finished FIPS (203–205). A **draft FIPS 206** for the FALCON signature algorithm was expected shortly after this announcement.
- **KEM commonality:** Both ML-KEM and HQC are **key encapsulation mechanisms (KEMs)** used as an initial handshake over public networks. NIST published draft implementation guidance in [SP 800-227](https://csrc.nist.gov/pubs/sp/800/227/ipd) (*Recommendations for Key Encapsulation Mechanisms*), with a February 2025 workshop and public comment through March 7, 2025.

## EBP relevance

EBP uses **ML-KEM-1024 only** today ([[ml-kem]]). **HQC is not implemented** and has no FIPS number yet; see [[hqc]] for standards-context notes and possible future diversification.

## Related Pages

- [[hqc]]
- [[ml-kem]]
- [[source-fips-203]]
- [[fn-dsa]]
- [[cryptographic-algorithm-transitions]]
- [[overview]]

## Sources

- `wiki/raw/NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption.md` (clipped from https://www.nist.gov/news-events/news/2025/03/nist-selects-hqc-fifth-algorithm-post-quantum-encryption, published 2025-03-11)
