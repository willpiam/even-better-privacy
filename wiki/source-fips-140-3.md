---
title: "Source Summary: NIST FIPS 140-3 — Cryptographic Modules"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - fips
  - cryptographic-modules
  - validation
---

# FIPS 140-3 — Security Requirements for Cryptographic Modules

**Raw file:** `wiki/raw/NIST.FIPS.140-3.pdf`
**Published:** March 22, 2019

## Summary

FIPS 140-3 specifies security requirements for cryptographic modules used to protect sensitive unclassified information in federal systems. It supersedes FIPS 140-2 and is tied to ISO/IEC 19790:2012, ISO/IEC 24759:2017, and NIST SP 800-140 validation guidance.

The local raw file appears to be a short extracted copy containing front matter, introductory material, and the table of contents rather than the full detailed requirements text. The summary should therefore be treated as high-level validation context unless the full publication is added later.

## Key Points

- FIPS 140-3 defines four qualitative security levels for cryptographic modules.
- The Cryptographic Module Validation Program validates modules against FIPS 140-3 and related NIST SP 800-140 series guidance.
- Requirement areas include module specification, interfaces, roles, services, authentication, software/firmware security, operating environment, physical security, sensitive security parameter management, self-tests, lifecycle assurance, and mitigation of other attacks.
- FIPS 140-3 validates cryptographic modules, not application protocols by itself.

## EBP Relevance

EBP uses NIST-standardized algorithms such as ML-KEM, ML-DSA, SLH-DSA, and AES. That does not imply EBP is a FIPS 140-3 validated cryptographic module. This distinction matters when documenting [[cryptographic-module-validation]], [[slh-dsa]] stateful-HBS comparisons, and any future compliance claims.

## Related Pages

- [[cryptographic-module-validation]]
- [[key-management]]
- [[source-sp-800-208]]
- [[slh-dsa]]

## Sources

- `wiki/raw/NIST.FIPS.140-3.pdf`
