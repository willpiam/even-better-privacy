---
title: "Source Summary: NIST FIPS 204 — ML-DSA"
type: source-summary
status: active
last_updated: 2026-04-08
source_count: 1
tags:
  - source
  - nist
  - ml-dsa
  - dilithium
  - signatures
---

# FIPS 204 — Module-Lattice-Based Digital Signature Algorithm (ML-DSA)

**Raw file:** `wiki/raw/nist.fips.204.pdf`
**Published:** August 13, 2024 by NIST

## Summary

FIPS 204 specifies ML-DSA, a digital signature algorithm based on the Module Learning With Errors (MLWE) and Module Short Integer Solution (MSIS) problems over lattices. It is derived from the CRYSTALS-Dilithium submission to the NIST Post-Quantum Cryptography Standardization process.

ML-DSA provides existential unforgeability under chosen-message attacks (EUF-CMA).

## Parameter Sets

| Parameter Set | NIST Security Category | Public Key (bytes) | Secret Key (bytes) | Signature (bytes) |
|---|---|---|---|---|
| ML-DSA-44 | 2 | 1,312 | 2,560 | 2,420 |
| ML-DSA-65 | 3 | 1,952 | 4,032 | 3,309 |
| ML-DSA-87 | 5 | 2,592 | 4,896 | 4,627 |

## EBP Usage

EBP uses **ML-DSA-87** (`ml_dsa87`) as its default signing scheme, providing NIST Security Category 5. The implementation uses the `@noble/post-quantum/ml-dsa` library. See [[ml-dsa]] for integration details.

Identities using ML-DSA produce fingerprints with the `ebpdk` bech32 human-readable prefix (Dilithium + Kyber).

## Key Design Properties

- **Lattice-based hardness:** security rests on the MLWE and MSIS problems.
- **Randomized signing:** each signature operation includes internal randomness, so signing the same message twice produces different signatures.
- **Relatively compact:** ML-DSA-87 signatures (4,627 bytes) are significantly smaller than SLH-DSA signatures while maintaining Category 5 security.

## Related Pages

- [[ml-dsa]]
- [[identity-model]]
- [[source-fips-203]]
- [[source-fips-205]]

## Sources

- `wiki/raw/nist.fips.204.pdf`
