---
title: "Cryptographic Module Validation"
type: concept
status: active
last_updated: 2026-04-25
source_count: 3
tags:
  - validation
  - fips
  - cryptographic-modules
  - compliance
---

# Cryptographic Module Validation

Cryptographic module validation is distinct from choosing standardized algorithms. FIPS 140-3, summarized in [[source-fips-140-3]], defines security requirements for cryptographic modules and is used by the Cryptographic Module Validation Program.

## EBP Boundary

EBP uses NIST-standardized primitives such as ML-KEM, ML-DSA, SLH-DSA, and AES. That does not imply that EBP, its dependencies, or its runtime environment form a FIPS 140-3 validated cryptographic module.

This distinction is important for compliance language:

- "Uses FIPS-standardized algorithms" can be accurate when tied to the relevant algorithm sources.
- "FIPS 140-3 validated" requires a validated module and a defined validation boundary.
- Random bit generation claims also depend on the module and entropy source boundary; see [[random-bit-generation]].

## Related Context

SP 800-208's stateful hash-based signature recommendation requires hardware cryptographic modules at FIPS 140-2/3 Level 3 or higher for signing. EBP avoids that operational requirement by using stateless [[slh-dsa]], but this is a design comparison, not a validation claim.

## Related Pages

- [[source-fips-140-3]]
- [[source-sp-800-208]]
- [[random-bit-generation]]
- [[key-management]]
- [[slh-dsa]]

## Sources

- `wiki/raw/NIST.FIPS.140-3.pdf` → [[source-fips-140-3]]
- `wiki/raw/NIST.SP.800-208.pdf` → [[source-sp-800-208]]
- `wiki/raw/NIST.SP.800-90B.pdf` → [[source-sp-800-90b]]
