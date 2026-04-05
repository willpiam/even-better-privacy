---
title: "ML-KEM (Kyber) in EBP"
type: entity
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - crypto
  - kem
  - kyber
---

# ML-KEM (Kyber)

EBP uses ML-KEM for confidentiality workflows. The documented variant is ML-KEM-1024.

## Role in EBP

- Used to encapsulate a freshly generated symmetric key.
- Symmetric key encrypts the message payload.
- Encapsulated key plus ciphertext are delivered to the recipient.

## Design Tradeoff

The project documents a straightforward per-message fresh key pattern, prioritizing simplicity and versatility over further efficiency tuning.

## Related Pages

- [[identity-model]]
- [[overview]]
- [[component-cli]]

## Sources

- `ReadMe.md`

