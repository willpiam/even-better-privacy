---
title: "Random Bit Generation Context"
type: concept
status: active
last_updated: 2026-04-25
source_count: 3
tags:
  - randomness
  - rng
  - drbg
  - entropy
---

# Random Bit Generation Context

EBP depends on cryptographic randomness for key generation, ML-KEM encapsulation, AES-GCM nonces, salts, and revocation-related values. The NIST SP 800-90 family provides useful vocabulary for reasoning about this dependency.

## NIST 90A/90B/90C Roles

- [[source-sp-800-90a-r1]] specifies deterministic random bit generator mechanisms such as Hash_DRBG, HMAC_DRBG, and CTR_DRBG.
- [[source-sp-800-90b]] specifies how entropy sources are characterized and validated.
- [[source-sp-800-90c]] composes entropy sources and DRBGs into full random bit generator constructions.

## EBP Boundary

EBP should use platform cryptographic randomness and avoid non-cryptographic RNGs. The NIST 90-series sources do not imply that EBP itself implements or validates an SP 800-90 RBG construction.

This distinction matters for wording: "uses cryptographic randomness from the environment" is appropriate when supported by code; "SP 800-90 compliant" or "FIPS-validated RNG" would require evidence about the runtime module and validation boundary.

## Related Pages

- [[source-sp-800-90a-r1]]
- [[source-sp-800-90b]]
- [[source-sp-800-90c]]
- [[aes-gcm]]
- [[ml-kem]]
- [[cryptographic-module-validation]]

## Sources

- `wiki/raw/NIST.SP.800-90Ar1.pdf` → [[source-sp-800-90a-r1]]
- `wiki/raw/NIST.SP.800-90B.pdf` → [[source-sp-800-90b]]
- `wiki/raw/NIST.SP.800-90C.pdf` → [[source-sp-800-90c]]
