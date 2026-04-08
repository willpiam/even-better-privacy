---
title: "Source Summary: NIST FIPS 205 — SLH-DSA"
type: source-summary
status: active
last_updated: 2026-04-08
source_count: 1
tags:
  - source
  - nist
  - slh-dsa
  - sphincs
  - signatures
  - hash-based
---

# FIPS 205 — Stateless Hash-Based Digital Signature Algorithm (SLH-DSA)

**Raw file:** `wiki/raw/NIST.FIPS.205.pdf`
**Published:** August 13, 2024 by NIST

## Summary

FIPS 205 specifies SLH-DSA, a stateless hash-based digital signature algorithm derived from the SPHINCS+ submission to the NIST Post-Quantum Cryptography Standardization process.

Unlike lattice-based schemes, SLH-DSA's security relies solely on the properties of cryptographic hash functions. This makes it a conservative, well-understood choice — its security assumptions are minimal and do not depend on the hardness of structured lattice problems.

## Parameter Sets (Selected)

SLH-DSA offers 12 parameter sets across two hash families (SHA-2 and SHAKE) and two optimization targets ("s" for small signatures, "f" for fast signing/verifying). Key examples:

| Parameter Set | NIST Category | Public Key (bytes) | Secret Key (bytes) | Signature (bytes) |
|---|---|---|---|---|
| SLH-DSA-SHA2-128s | 1 | 32 | 64 | 7,856 |
| SLH-DSA-SHA2-128f | 1 | 32 | 64 | 17,088 |
| SLH-DSA-SHA2-192s | 3 | 48 | 96 | 16,224 |
| SLH-DSA-SHA2-256s | 5 | 64 | 128 | 29,792 |
| SLH-DSA-SHA2-256f | 5 | 64 | 128 | 49,856 |

## EBP Usage

EBP uses **SLH-DSA-SHA2-256s** (`slh_dsa_sha2_256s`) as its hash-based signing option, providing NIST Security Category 5. The implementation uses the `@noble/post-quantum/slh-dsa` library. See [[slh-dsa]] for integration details.

Identities using SLH-DSA produce fingerprints with the `ebpsk` bech32 human-readable prefix (SPHINCS+ + Kyber).

## Key Design Properties

- **Hash-only security:** does not rely on lattice assumptions, making it a diversification option alongside ML-DSA.
- **Stateless:** no state management required between signing operations (unlike earlier hash-based schemes like XMSS/LMS).
- **Compact keys, large signatures:** public keys are very small (64 bytes at Category 5) but signatures are large (29,792 bytes for SHA2-256s).
- **"s" vs "f" tradeoff:** "s" variants produce smaller signatures at the cost of slower signing; "f" variants sign faster but produce larger signatures.

## Related Pages

- [[slh-dsa]]
- [[identity-model]]
- [[source-fips-203]]
- [[source-fips-204]]

## Sources

- `wiki/raw/NIST.FIPS.205.pdf`
