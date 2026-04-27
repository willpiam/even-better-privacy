---
title: "Source Summary: NIST SP 800-38C — CCM"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - ccm
  - aead
  - aes
---

# NIST SP 800-38C — CCM Mode

**Raw file:** `wiki/raw/nistspecialpublication800-38c.pdf`
**Published:** May 2004
**Errata:** July 20, 2007

## Summary

NIST SP 800-38C specifies CCM, an authenticated encryption mode built from CTR mode and CBC-MAC. CCM provides confidentiality for payload data and authentication for both payload data and associated data.

CCM is not the mode EBP uses; it is included as NIST AEAD background and as a contrast with [[source-sp-800-38d|GCM]].

## Key Points

- CCM requires an approved 128-bit block cipher such as AES.
- Inputs include payload, associated data, nonce, and authentication tag length.
- The nonce must be unique for the key and protected payload context.
- CCM is oriented toward whole-message processing rather than arbitrary streaming.
- Associated data is authenticated but not encrypted.

## EBP Relevance

EBP uses AES-256-GCM, not CCM. The relevant EBP page is [[aes-gcm]], while this source helps keep terminology precise when discussing NIST authenticated encryption modes.

## Related Pages

- [[aes-gcm]]
- [[source-sp-800-38d]]
- [[source-fips-197]]

## Sources

- `wiki/raw/nistspecialpublication800-38c.pdf`
