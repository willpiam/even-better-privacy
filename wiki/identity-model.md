---
title: "EBP Identity Model"
type: concept
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - identity
  - fingerprint
  - keys
---

# EBP Identity Model

EBP identities are explicitly dual-key identities:

- a signing key (authenticity/integrity)
- an encryption/KEM key (confidentiality)

This model is central to EBP and avoids treating encryption and signatures as interchangeable capabilities.

## Fingerprint Construction

Fingerprinting uses:

- a merkle root over the two public keys
- bech32 encoding with scheme-specific prefixes

Current documented prefixes include `ebpdk1...` and `ebpsk1...` for specific scheme pairings.

## Why This Matters

- Supports message signing and verification workflows.
- Supports encryption/KEM-based confidentiality workflows.
- Allows trust decisions to be anchored to a single identity fingerprint.

## Related Pages

- [[overview]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[revocation-system]]

## Sources

- `ReadMe.md`

