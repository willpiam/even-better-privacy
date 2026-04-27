---
title: "Source Summary: NIST SP 800-38D — GCM and GMAC"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - gcm
  - gmac
  - aead
  - aes
---

# NIST SP 800-38D — GCM and GMAC

**Raw file:** `wiki/raw/nistspecialpublication800-38d.pdf`
**Published:** November 2007

## Summary

NIST SP 800-38D specifies Galois/Counter Mode (GCM) for authenticated encryption and GMAC for message authentication. GCM combines counter-mode encryption with GHASH authentication over both ciphertext and associated data.

This is the primary NIST source for EBP's AES-256-GCM layer.

## Key Points

- GCM provides confidentiality for plaintext and authenticity for plaintext plus associated data.
- GMAC is the authentication-only mode over associated data.
- The IV is a nonce: uniqueness for a given key is central to security.
- NIST recommends 96-bit IVs for interoperability and efficient processing.
- If nonces are generated randomly under a long-lived key, invocation limits and collision probability must be managed.
- Associated data is the standard mechanism for binding cleartext protocol metadata to the authentication tag.

## EBP Relevance

EBP encrypts message payloads as `encapsulatedKey || nonce || aesCiphertext`. The nonce is 12 bytes, matching the recommended 96-bit GCM IV size. Because EBP performs a fresh [[ml-kem]] encapsulation for each message, the AES key is intended to be per-message rather than long-lived.

The source also reinforces a known design consideration: cleartext protocol metadata that must be integrity-bound should be included as GCM associated data or otherwise covered by signatures. See [[aes-gcm]] and [[message-payload-formats]].

## Related Pages

- [[aes-gcm]]
- [[message-payload-formats]]
- [[ml-kem]]
- [[source-fips-197]]
- [[source-sp-800-38c]]

## Sources

- `wiki/raw/nistspecialpublication800-38d.pdf`
