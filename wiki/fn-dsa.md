---
title: "FN-DSA (Falcon) — Planned"
type: entity
status: seed
last_updated: 2026-05-20
source_count: 2
tags:
  - crypto
  - signatures
  - falcon
  - planned
---

# FN-DSA (Falcon) — Planned

FN-DSA (Fast-Fourier lattice-based compact signatures over NTRU) is a planned future signing scheme for EBP. It is based on the Falcon submission to the NIST Post-Quantum Cryptography Standardization process.

## Status in EBP

**Not yet implemented.** Listed in the README's crypto-systems table as "Planned" with no variant or key sizes specified. The codebase does not yet include any Falcon-related code.

## Why FN-DSA?

FN-DSA would provide a third signing option alongside [[ml-dsa]] and [[slh-dsa]], offering a different tradeoff:

- **Compact signatures:** Falcon signatures are significantly smaller than both ML-DSA and SLH-DSA at comparable security levels.
- **NTRU-based:** uses a different lattice structure (NTRU) than ML-DSA (MLWE/MSIS), providing further cryptographic diversity.
- **Complex implementation:** Falcon requires careful floating-point handling or specialized integer arithmetic, which has historically made it harder to implement securely.

NIST announced in March 2025 that a **draft FIPS 206** built around the FALCON algorithm would be released shortly ([[source-nist-hqc-fifth-pq-encryption]]). FN-DSA is not yet finalized in EBP's codebase.

## Expected Integration

When implemented, FN-DSA would follow the same pattern as existing signing schemes:

- A new `FalconSigningKey` class in `core/`.
- A new fingerprint HRP (e.g., `ebpfk` for Falcon + Kyber).
- Registration in the `Identity` constructor's signing key switch.

## Related Pages

- [[ml-dsa]]
- [[slh-dsa]]
- [[identity-model]]
- [[overview]]
- [[source-nist-hqc-fifth-pq-encryption]]

## Sources

- `ReadMe.md`
- `wiki/raw/NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption.md` → [[source-nist-hqc-fifth-pq-encryption]]
