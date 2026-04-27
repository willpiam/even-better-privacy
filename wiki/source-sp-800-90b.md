---
title: "Source Summary: NIST SP 800-90B"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - randomness
  - entropy
  - rng
---

# NIST SP 800-90B — Entropy Sources for Random Bit Generation

**Raw file:** `wiki/raw/NIST.SP.800-90B.pdf`
**Published:** January 2018

## Summary

NIST SP 800-90B recommends how to characterize and validate entropy sources used for random bit generation. It focuses on noise sources, conditioning, health tests, min-entropy estimation, and validation data collection.

## Key Points

- Entropy sources are modeled as a noise source, optional conditioning component, and health-test mechanisms.
- Min-entropy is the core quantity used to reason about unpredictability.
- IID and non-IID sources have different estimation and validation paths.
- Health tests such as repetition count and adaptive proportion tests detect catastrophic or significant failures.
- The document is validation-oriented and does not mean an application using an OS RNG automatically satisfies SP 800-90B.

## EBP Relevance

EBP should use cryptographic randomness from its runtime environment and avoid non-cryptographic RNGs. It should not claim SP 800-90B validation unless using a validated entropy source and module. See [[random-bit-generation]].

## Related Pages

- [[random-bit-generation]]
- [[source-sp-800-90a-r1]]
- [[source-sp-800-90c]]
- [[cryptographic-module-validation]]

## Sources

- `wiki/raw/NIST.SP.800-90B.pdf`
