---
title: "OpenPGP PQC Context"
type: concept
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - openpgp
  - post-quantum
  - interoperability
---

# OpenPGP PQC Context

OpenPGP's post-quantum work is relevant to EBP as an adjacent standards track, not as EBP's protocol definition. The current Internet-Draft summarized in [[source-draft-ietf-openpgp-pqc-17]] extends RFC 9580 OpenPGP packets and keys with post-quantum algorithms.

## Contrast With EBP

EBP and OpenPGP PQC share some primitive families but make different integration choices:

| Area | OpenPGP PQC draft | EBP |
|---|---|---|
| Message format | OpenPGP packets | JSON payloads with EBP armor, see [[message-payload-formats]] |
| KEM | Composite ML-KEM + X25519/X448 | Direct [[ml-kem|ML-KEM-1024]] per message |
| Signatures | Composite ML-DSA + EdDSA and SLH-DSA-SHAKE variants | Direct [[ml-dsa|ML-DSA-87]] or [[slh-dsa|SLH-DSA-SHA2-256s]] |
| Identity | OpenPGP key/certificate model | Dual-key [[identity-model]] with bech32 fingerprint |

## Wiki Guidance

Use this page when comparing EBP to PGP-like ecosystems. Do not cite OpenPGP PQC algorithm identifiers as EBP identifiers, and do not imply that EBP armored payloads are OpenPGP messages.

## Related Pages

- [[source-draft-ietf-openpgp-pqc-17]]
- [[message-payload-formats]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]

## Sources

- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
