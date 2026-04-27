---
title: "Source Summary: NIST SP 800-90C"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - randomness
  - rbg
  - rng
---

# NIST SP 800-90C — Random Bit Generator Constructions

**Raw file:** `wiki/raw/NIST.SP.800-90C.pdf`
**Published:** September 2025

## Summary

NIST SP 800-90C recommends full random bit generator constructions by composing SP 800-90A DRBG mechanisms with SP 800-90B entropy sources. It defines constructions such as RBG1, RBG2, RBG3, and RBGC.

## Key Points

- SP 800-90C is the construction-level document for the NIST 90A/90B/90C RBG family.
- It clarifies the relationship between entropy sources, conditioning, DRBGs, reseeding, and generation.
- The publication notes differences from SP 800-90A Revision 1 around nonce/randomness handling and prediction-resistance requests.
- NIST expects a future SP 800-90A Revision 2 to align with SP 800-90C.
- For federal RBG designs, 90C is the current top-level construction reference.

## EBP Relevance

EBP does not implement or validate an RBG construction as a cryptographic module. SP 800-90C is still useful for [[random-bit-generation]] because it clarifies the difference between relying on platform CSPRNG APIs and making formal NIST RBG construction claims.

## Related Pages

- [[random-bit-generation]]
- [[source-sp-800-90a-r1]]
- [[source-sp-800-90b]]
- [[cryptographic-module-validation]]

## Sources

- `wiki/raw/NIST.SP.800-90C.pdf`
