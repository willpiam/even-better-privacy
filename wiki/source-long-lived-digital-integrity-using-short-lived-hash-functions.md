---
title: Long-lived digital integrity using short-lived hash functions
type: source-summary
status: active
last_updated: 2026-04-30
source_count: 1
tags:
  - timestamping
  - signatures
  - hash-agility
  - archival-integrity
---

# Long-lived digital integrity using short-lived hash functions

This source describes how to preserve long-term evidentiary integrity when an older hash function is later weakened. The core idea is "renewal" by obtaining a new time-stamp over the right tuple of old evidence, rather than re-time-stamping a certificate in isolation.

## Key Points

- For old time-stamp certificates, renew by time-stamping the pair `(x, c1)` (document + original certificate), not `c1` alone.
- Re-time-stamping only the old certificate can permit back-dating attacks once the old hash function is breakable.
- The same renewal logic applies to digital signatures, not only to standalone time-stamp certificates.
- For signatures, long-term validation must include PKI validation evidence (`V`: cert chain, CRLs/OCSP, related trusted statements), either bundled or retrievable from trustworthy archives.
- Renewal effectiveness assumes the old system is not already fully compromised before renewal is performed.

## Signature Applicability

The paper is explicit that renewal applies to signatures. For a signed object, preserving future verifiability requires renewed evidence over the signature context (content, signature, and validation context), not only over an old certificate artifact.

## EBP Relevance

- Reinforces hash-agility planning for long-lived signed artifacts in [[message-payload-formats]].
- Provides a model for preserving verifiability across algorithm transitions in [[cryptographic-algorithm-transitions]].
- Supports documenting archival verification chains for signed data under [[key-management]].

## Related Pages

- [[integrity-renewal]]
- [[key-management]]
- [[message-payload-formats]]
- [[cryptographic-algorithm-transitions]]

## Sources

- `wiki/raw/Long-lived-digital-integrity-using-short-lived-hash-functions.pdf`
