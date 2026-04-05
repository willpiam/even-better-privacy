---
title: "SLH-DSA (SPHINCS+) in EBP"
type: entity
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - crypto
  - signatures
  - sphincs
---

# SLH-DSA (SPHINCS+)

EBP supports SLH-DSA as a signing/authentication scheme (documented SHA2-256s variant).

## Role in EBP

- Signs messages and certificates.
- Enables receivers to verify authenticity with public signing keys.
- Participates in dual-key identity pairings with ML-KEM.

## Related Pages

- [[identity-model]]
- [[revocation-system]]
- [[overview]]

## Sources

- `ReadMe.md`

