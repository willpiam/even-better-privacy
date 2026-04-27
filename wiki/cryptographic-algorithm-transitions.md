---
title: "Cryptographic Algorithm Transitions"
type: concept
status: active
last_updated: 2026-04-25
source_count: 2
tags:
  - algorithms
  - transitions
  - key-management
  - policy
---

# Cryptographic Algorithm Transitions

Cryptographic algorithms and key sizes have lifetimes. NIST SP 800-131A Revision 2, summarized in [[source-sp-800-131a-r2]], classifies classical algorithm uses as acceptable, deprecated, legacy-use, or disallowed.

## EBP Context

EBP's current asymmetric direction is post-quantum and is grounded in FIPS 203, FIPS 204, and FIPS 205. SP 800-131A Revision 2 predates those final PQC standards, so it should be used as transition-policy context rather than as the source for EBP's ML-KEM, ML-DSA, or SLH-DSA choices.

SP 800-57 Part 1, summarized in [[source-sp-800-57-part-1-r5]], complements this with security-strength and cryptoperiod planning.

## Wiki Guidance

When documenting transitions:

- Distinguish algorithm strength from implementation and key-management strength.
- Separate old-data verification or processing from new-data protection.
- Avoid using SP 800-131A Rev. 2 as if it were current PQC transition guidance.
- Keep dates and status words tied to the specific algorithm use described by the source.

## Related Pages

- [[source-sp-800-131a-r2]]
- [[source-sp-800-57-part-1-r5]]
- [[key-management]]
- [[overview]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]

## Sources

- `wiki/raw/NIST.SP.800-131Ar2.pdf` → [[source-sp-800-131a-r2]]
- `wiki/raw/NIST.SP.800-57pt1r5.pdf` → [[source-sp-800-57-part-1-r5]]
