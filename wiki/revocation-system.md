---
title: "EBP Revocation System"
type: concept
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - revocation
  - trust
  - certificates
---

# EBP Revocation System

EBP supports signed revocation for both individual identity details and entire identities.

## Revocation Types

- Detail revocation: removes a specific detail path (for example, an old email).
- Identity revocation: marks an entire identity as invalid/compromised (irreversible intent).

## Certificate Characteristics

Revocation certificates include:

- revocation type
- target fingerprint
- monotonically increasing nonce
- timestamp
- optional reason
- target path (for detail revocation)
- signature from the identity

## Operational Notes

- Nonces are used to prevent replay.
- Emergency revocation certificates are supported for loss/compromise scenarios.
- Server responses can include revoked identity status and revoked detail paths.

## Related Pages

- [[identity-model]]
- [[component-server]]
- [[overview]]

## Sources

- `ReadMe.md`

