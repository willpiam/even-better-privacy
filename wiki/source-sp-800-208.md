---
title: "NIST SP 800-208: Recommendation for Stateful Hash-Based Signature Schemes"
type: source-summary
status: active
last_updated: 2026-04-12
source_count: 1
tags:
  - crypto
  - signatures
  - hash-based
  - xmss
  - lms
  - post-quantum
  - stateful
  - nist
---

# NIST SP 800-208: Recommendation for Stateful Hash-Based Signature Schemes

NIST Special Publication 800-208 (October 2020) is a federal recommendation that approves two stateful hash-based signature (HBS) schemes for government use: **LMS** (Leighton-Micali Signature, RFC 8554) and **XMSS** (eXtended Merkle Signature Scheme, RFC 8391), along with their multi-tree variants **HSS** and **XMSS^MT**. This was the first NIST publication to approve post-quantum digital signature algorithms.

## Scope and Intended Applications

Stateful HBS schemes are **not** intended as general-purpose replacements for RSA or ECDSA. They are recommended for applications where:

1. A digital signature scheme must be deployed in the near future.
2. The deployment will have a long lifetime (potentially decades).
3. Transitioning to a different scheme after deployment would be impractical.

The canonical example is **firmware update authentication for constrained devices** — devices deployed for decades that cannot easily change their signature verification code.

## The State Management Problem

The critical operational constraint: each one-time signature (OTS) key must never sign more than one message. If an attacker obtains two signatures from the same OTS key, forging arbitrary signatures becomes computationally feasible. This requirement demands:

- Hardware cryptographic modules (FIPS 140-2/3 Level 3+) for key generation and signing.
- Non-volatile storage updates **before** exporting any signature.
- No export of private keying material, even encrypted.
- Monotonic counters where available to prevent index reuse after power loss.

## Approved Hash Functions

SP 800-208 approves four hash functions (unlike RFC 8391 which also allowed SHA2-512 and SHAKE128):

| Hash Function | Output Size | Notes |
|---|---|---|
| SHA-256 | 256 bits | From RFC 8391/8554 parameter sets |
| SHA-256/192 | 192 bits | Truncated SHA-256, new in SP 800-208 |
| SHAKE256/256 | 256 bits | New in SP 800-208 |
| SHAKE256/192 | 192 bits | New in SP 800-208 |

The 192-bit variants offer smaller signatures but reduced collision resistance (2^96 vs 2^128 for generic collision search). SP 800-208 notes this weakens the verifier's assurance against signer repudiation but does not affect formal unforgeability.

## Approved LMS Parameter Sets

Tree heights h = 5, 10, 15, 20, or 25. Winternitz parameter w = 1, 2, 4, or 8.

| Hash | OTS Examples | LMS Tree Heights |
|---|---|---|
| SHA-256 (n=32) | LMOTS\_SHA256\_N32\_W1 through W8 | H5, H10, H15, H20, H25 |
| SHA-256/192 (n=24) | LMOTS\_SHA256\_N24\_W1 through W8 | H5 through H25 |
| SHAKE256/256 (n=32) | LMOTS\_SHAKE\_N32\_W1 through W8 | H5 through H25 |
| SHAKE256/192 (n=24) | LMOTS\_SHAKE\_N24\_W1 through W8 | H5 through H25 |

HSS allows up to 8 levels of trees.

## Approved XMSS Parameter Sets

Tree heights h = 10, 16, or 20. All use w=16. See [[source-rfc-8391]] for full parameter tables.

| Hash | XMSS Examples | XMSS^MT Examples |
|---|---|---|
| SHA-256 (n=32) | XMSS-SHA2\_{10,16,20}\_256 | XMSSMT-SHA2\_{20/2..60/12}\_256 |
| SHA-256/192 (n=24) | XMSS-SHA2\_{10,16,20}\_192 | XMSSMT-SHA2\_{20/2..60/12}\_192 |
| SHAKE256/256 (n=32) | XMSS-SHAKE256\_{10,16,20}\_256 | XMSSMT-SHAKE256\_{20/2..60/12}\_256 |
| SHAKE256/192 (n=24) | XMSS-SHAKE256\_{10,16,20}\_192 | XMSSMT-SHAKE256\_{20/2..60/12}\_192 |

XMSS^MT allows up to 12 levels of trees (d ≤ 12).

**Not approved:** RFC 8391 parameter sets using SHA2-512, SHAKE128, or SHAKE256 with n=64.

## Key Generation Requirements

SP 800-208 mandates a specific pseudorandom key generation method for WOTS+ private keys using a new function `PRFkeygen`:

```
PRFkeygen(KEY, M): Hash(toByte(4, n) || KEY || M)
```

where Hash is the parameter-set-specific hash function. This differs from RFC 8391's original key generation options by requiring a deterministic derivation from a random seed `S_XMSS`, ensuring reproducibility within a single cryptographic module.

## Distributed Multi-Tree Signatures

Section 7 addresses the single-point-of-failure problem: if the hardware module holding the private key fails, the key is lost. SP 800-208 recommends XMSS^MT or HSS with two levels of trees distributed across multiple hardware modules:

1. A top-level tree on one module signs roots of bottom-level trees.
2. Bottom-level trees are created on separate modules for redundancy.
3. All bottom-level keys should be generated up front during the key ceremony.

## Conformance Requirements

- Signing **must** be performed in hardware cryptographic modules (FIPS 140-2/3 Level 3+).
- Private keying material **must not** be exported, even encrypted.
- The leaf index **must** be persisted to nonvolatile storage before any signature is exported.
- The entropy source for random bit generation **must** reside inside the module's physical boundary.

## Relationship to EBP

EBP does **not** use LMS, XMSS, or their multi-tree variants. EBP chose [[slh-dsa]] (SPHINCS+, FIPS 205), the **stateless** evolution of hash-based signatures, specifically to avoid the state management complexity that SP 800-208 extensively documents.

SP 800-208 is relevant context because:
- It was the first NIST post-quantum signature recommendation, predating FIPS 203/204/205.
- The document's thorough analysis of OTS key reuse risks and hardware module requirements illustrates exactly the operational burden that SLH-DSA was designed to eliminate.
- The Merkle tree and WOTS+ primitives profiled here are the same building blocks inside SLH-DSA's hypertree, but SLH-DSA uses them in a few-time (not one-time) fashion with a virtual tree structure.

## Related Pages

- [[source-rfc-8391]]
- [[slh-dsa]]
- [[source-fips-205]]
- [[overview]]

## Sources

- `wiki/raw/NIST.SP.800-208.pdf` (NIST SP 800-208, October 2020)
