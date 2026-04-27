---
title: "AES-GCM in EBP"
type: concept
status: active
last_updated: 2026-04-25
source_count: 3
tags:
  - aes
  - gcm
  - aead
  - encryption
---

# AES-GCM in EBP

EBP uses AES-256-GCM as the symmetric encryption layer after [[ml-kem]] encapsulation. AES itself is specified by [[source-fips-197]], while GCM and GMAC are specified by [[source-sp-800-38d]].

## EBP Pattern

For encrypted payloads, EBP transmits:

`encapsulatedKey || nonce || aesCiphertext`

The current encrypted payload format uses:

- ML-KEM-1024 encapsulated key: 1,568 bytes.
- GCM nonce/IV: 12 bytes.
- AES-GCM ciphertext and authentication tag as produced by the implementation.

The 12-byte nonce matches SP 800-38D's recommended 96-bit IV size. EBP's per-message ML-KEM encapsulation is intended to produce a fresh 32-byte shared secret for each message, which is then used as the AES-256-GCM key.

## Associated Data

SP 800-38D treats associated data as the standard way to authenticate cleartext metadata. EBP currently documents payload fields separately from the encrypted inner payload on [[message-payload-formats]]. When protocol metadata must be integrity-bound to the ciphertext, it should either be covered by AES-GCM associated data or by a signature over the relevant context.

## CCM Contrast

NIST SP 800-38C defines CCM, another AES-based AEAD mode. EBP does not use CCM; [[source-sp-800-38c]] is included only as related NIST AEAD context.

## Related Pages

- [[source-fips-197]]
- [[source-sp-800-38d]]
- [[source-sp-800-38c]]
- [[ml-kem]]
- [[message-payload-formats]]
- [[random-bit-generation]]

## Sources

- `wiki/raw/NIST.FIPS.197-upd1.pdf` → [[source-fips-197]]
- `wiki/raw/nistspecialpublication800-38d.pdf` → [[source-sp-800-38d]]
- `wiki/raw/nistspecialpublication800-38c.pdf` → [[source-sp-800-38c]]
