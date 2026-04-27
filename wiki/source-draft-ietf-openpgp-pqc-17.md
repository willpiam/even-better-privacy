---
title: "Source Summary: draft-ietf-openpgp-pqc-17"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - ietf
  - openpgp
  - post-quantum
  - hybrid
---

# draft-ietf-openpgp-pqc-17 — Post-Quantum Cryptography in OpenPGP

**Raw file:** `wiki/raw/draft-ietf-openpgp-pqc-17.txt`
**Date:** January 13, 2026
**Status:** Internet-Draft, Standards Track work in progress

## Summary

`draft-ietf-openpgp-pqc-17` defines post-quantum public-key algorithms for OpenPGP, extending RFC 9580 packet and key semantics. It profiles composite KEMs, composite signatures, and standalone SLH-DSA signatures for OpenPGP deployments.

The draft is related background for EBP because both systems use NIST post-quantum primitives, but it is not EBP's wire format. EBP uses its own JSON payloads and bech32 fingerprinted identity model; OpenPGP PQC uses OpenPGP packets, key versions, algorithm identifiers, and certificate semantics.

## Algorithms and Semantics

- KEM algorithm IDs include **ML-KEM-768+X25519** and **ML-KEM-1024+X448** composites.
- Signature algorithm IDs include **ML-DSA-65+Ed25519**, **ML-DSA-87+Ed448**, and standalone **SLH-DSA-SHAKE** variants.
- Composite operations require every component to succeed: both KEM decapsulations must contribute to the combined secret, and both signature components must verify.
- The draft also discusses non-composite migration patterns using multiple signature packets or multiple public-key encrypted session key packets.
- Most post-quantum algorithms are bound to OpenPGP v6+ keys, with a special allowance for ML-KEM-768+X25519 on v4 encryption-capable subkeys.

## EBP Relevance

The draft provides useful interop and migration context for [[openpgp-pqc]], [[ml-kem]], [[ml-dsa]], and [[slh-dsa]]. It should not be cited as an EBP payload specification. The main differences are:

- EBP uses **ML-KEM-1024 directly** with AES-256-GCM, while the draft's high-strength OpenPGP KEM is **ML-KEM-1024+X448**.
- EBP uses **ML-DSA-87 directly**, while the draft's high-strength composite signature pairs **ML-DSA-87+Ed448**.
- EBP's default SLH-DSA variant is **SLH-DSA-SHA2-256s**; the draft registers **SLH-DSA-SHAKE** variants.
- EBP does not use OpenPGP packet formats, OpenPGP certificates, or OpenPGP trust semantics.

## Related Pages

- [[openpgp-pqc]]
- [[message-payload-formats]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]

## Sources

- `wiki/raw/draft-ietf-openpgp-pqc-17.txt`
