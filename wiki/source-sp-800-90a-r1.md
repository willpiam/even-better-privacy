---
title: "Source Summary: NIST SP 800-90A Rev. 1"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - randomness
  - drbg
  - rng
---

# NIST SP 800-90A Rev. 1 — Deterministic Random Bit Generators

**Raw file:** `wiki/raw/NIST.SP.800-90Ar1.pdf`
**Published:** June 2015

## Summary

NIST SP 800-90A Revision 1 specifies deterministic random bit generator mechanisms. It defines Hash_DRBG, HMAC_DRBG, and CTR_DRBG, along with instantiation, reseeding, generation, prediction resistance, and security-strength concepts.

SP 800-90A is one part of the NIST random bit generation family: SP 800-90B addresses entropy sources, and SP 800-90C composes entropy sources and DRBGs into full RBG constructions.

## Key Points

- DRBG output is pseudorandom and depends on sufficient entropy at instantiation and reseeding.
- The standard defines security strengths and DRBG state transitions.
- Personalization strings, additional input, and reseeding are used to separate contexts and recover from possible state exposure.
- Backtracking resistance and prediction resistance describe recovery goals after state compromise.
- SP 800-90C updates how current NIST RBG constructions should be framed and notes planned alignment work for SP 800-90A Revision 2.

## EBP Relevance

EBP relies on platform cryptographic randomness rather than implementing a NIST-validated DRBG itself. This source is relevant to [[random-bit-generation]] and to any documentation about nonces, salts, KEM encapsulation randomness, and key generation.

## Related Pages

- [[random-bit-generation]]
- [[source-sp-800-90b]]
- [[source-sp-800-90c]]
- [[aes-gcm]]
- [[ml-kem]]

## Sources

- `wiki/raw/NIST.SP.800-90Ar1.pdf`
