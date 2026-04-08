---
title: "FN-DSA (Falcon) — Planned"
type: entity
status: seed
last_updated: 2026-04-08
source_count: 1
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

NIST has not yet finalized FN-DSA as a FIPS standard (it was selected for standardization but the final spec was still in draft as of early 2025).

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

## Sources

- `ReadMe.md`
