---
title: "Source Summary: NIST SP 800-131A Rev. 2"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - transitions
  - algorithms
  - key-lengths
---

# NIST SP 800-131A Rev. 2 — Transitioning Cryptographic Algorithms and Key Lengths

**Raw file:** `wiki/raw/NIST.SP.800-131Ar2.pdf`
**Published:** March 2019

## Summary

NIST SP 800-131A Revision 2 gives transition guidance for the use of cryptographic algorithms and key lengths. It complements SP 800-57 Part 1 by classifying algorithm uses as acceptable, deprecated, legacy-use, or disallowed.

The publication predates final NIST PQC standards and explicitly treats post-quantum cryptography as future transition work. EBP's PQC choices are therefore grounded in FIPS 203, 204, and 205, not in SP 800-131A alone.

## Key Points

- New federal protection generally requires at least 112 bits of classical security strength.
- Older data may sometimes be processed under legacy-use rules when risk is accepted.
- The document gives transition status for classical algorithms and uses such as TDEA, RSA, DH, digital signatures, hashes, and DRBG mechanisms.
- It emphasizes cryptographic agility in anticipation of future post-quantum migration guidance.
- Transition status depends on both algorithm and use: generation, verification, protection, processing, and legacy validation can differ.

## EBP Relevance

SP 800-131A is background for [[cryptographic-algorithm-transitions]]. It supports cautious wording about classical algorithm lifetimes and transition planning, but it should not be used to justify specific ML-KEM, ML-DSA, or SLH-DSA parameter choices.

## Related Pages

- [[cryptographic-algorithm-transitions]]
- [[key-management]]
- [[source-sp-800-57-part-1-r5]]
- [[overview]]

## Sources

- `wiki/raw/NIST.SP.800-131Ar2.pdf`
