---
title: "Source Summary: NIST FIPS 197 — AES"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - fips
  - aes
  - symmetric-encryption
---

# FIPS 197 — Advanced Encryption Standard (AES)

**Raw file:** `wiki/raw/NIST.FIPS.197-upd1.pdf`
**Updated:** May 9, 2023

## Summary

FIPS 197 specifies the Advanced Encryption Standard block cipher. AES is based on Rijndael, uses a 128-bit block size, and supports 128-bit, 192-bit, and 256-bit keys.

FIPS 197 defines the block cipher itself, not an authenticated encryption mode. For EBP's AES-256-GCM usage, FIPS 197 is the block-cipher foundation and [[source-sp-800-38d]] is the relevant mode recommendation.

## Key Points

- AES uses a 128-bit block and key sizes of 128, 192, or 256 bits.
- The standard defines the cipher, inverse cipher, key schedule, and equivalent inverse cipher.
- Multi-block message encryption requires a NIST-approved or NIST-recommended mode of operation.
- FIPS 197 does not define IV/nonce handling, authentication tags, associated data, or AEAD semantics.

## EBP Relevance

EBP uses AES-256-GCM after [[ml-kem]] encapsulation produces a 32-byte shared secret. The AES portion is grounded in FIPS 197, while the GCM AEAD behavior comes from [[source-sp-800-38d]] and is summarized on [[aes-gcm]].

## Related Pages

- [[aes-gcm]]
- [[ml-kem]]
- [[message-payload-formats]]
- [[source-sp-800-38d]]

## Sources

- `wiki/raw/NIST.FIPS.197-upd1.pdf`
