---
title: "Source Summary: NIST FIPS 203 — ML-KEM"
type: source-summary
status: active
last_updated: 2026-04-08
source_count: 1
tags:
  - source
  - nist
  - ml-kem
  - kyber
  - kem
---

# FIPS 203 — Module-Lattice-Based Key-Encapsulation Mechanism (ML-KEM)

**Raw file:** `wiki/raw/NIST.FIPS.203.pdf`
**Published:** August 13, 2024 by NIST

## Summary

FIPS 203 specifies ML-KEM, a key-encapsulation mechanism based on the Module Learning With Errors (MLWE) problem over lattices. It is derived from the CRYSTALS-Kyber submission to the NIST Post-Quantum Cryptography Standardization process.

ML-KEM allows two parties to establish a shared secret over a public channel. The encapsulating party generates a random shared secret and a ciphertext; the decapsulating party recovers the shared secret using their private key.

## Parameter Sets

| Parameter Set | NIST Security Category | Public Key (bytes) | Secret Key (bytes) | Ciphertext (bytes) | Shared Secret (bytes) |
|---|---|---|---|---|---|
| ML-KEM-512 | 1 | 800 | 1,632 | 768 | 32 |
| ML-KEM-768 | 3 | 1,184 | 2,400 | 1,088 | 32 |
| ML-KEM-1024 | 5 | 1,568 | 3,168 | 1,568 | 32 |

## EBP Usage

EBP uses **ML-KEM-1024** (NIST Security Category 5) for all confidentiality workflows. The implementation uses the `@noble/post-quantum/ml-kem` library. See [[ml-kem]] for integration details.

## Key Design Properties

- **IND-CCA2 security:** ML-KEM provides chosen-ciphertext security via an implicit rejection mechanism.
- **Lattice-based hardness:** security rests on the difficulty of the MLWE problem.
- **Deterministic decapsulation:** given the same ciphertext and secret key, decapsulation always produces the same shared secret.
- **Fresh key per message:** EBP generates a fresh shared secret for every message via encapsulation, then uses it as an AES-256-GCM key.

## Related Pages

- [[ml-kem]]
- [[identity-model]]
- [[source-fips-204]]
- [[source-fips-205]]

## Sources

- `wiki/raw/NIST.FIPS.203.pdf`
