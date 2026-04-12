---
title: "SLH-DSA (SPHINCS+) in EBP"
type: entity
status: active
last_updated: 2026-04-12
source_count: 5
tags:
  - crypto
  - signatures
  - sphincs
  - hash-based
---

# SLH-DSA (SPHINCS+)

SLH-DSA (Stateless Hash-Based Digital Signature Algorithm) is one of two signing schemes supported by EBP. It is standardized as NIST FIPS 205, derived from the SPHINCS+ submission. See [[source-fips-205]] for the full standard summary.

## Variant Used

EBP uses **SLH-DSA-SHA2-256s** (`slh_dsa_sha2_256s`), a small-signature Category 5 parameter set:

| Property | Value |
|---|---|
| Public key size | 64 bytes |
| Secret key size | 128 bytes |
| Signature size | 29,792 bytes |

The default variant is set in `core/Sphincs.ts` via `SphincsSigningKey(variant = "slh_dsa_sha2_256s")`. The implementation uses the `@noble/post-quantum/slh-dsa` library.

## Role in EBP

SLH-DSA serves the same signing role as [[ml-dsa]] in EBP's dual-key [[identity-model]]:

- **Message signing:** signs a hash envelope of the message to produce a signature.
- **Detail proofs:** signed proof records for attached identity details.
- **Revocation certificates:** signs revocation certificates. See [[revocation-system]].
- **State transitions:** signs state-transition messages for server publishing.

## Why Include SLH-DSA?

SLH-DSA provides **cryptographic diversity**. Its security rests entirely on the properties of hash functions — it makes no lattice assumptions. If a future breakthrough weakens lattice-based schemes (affecting ML-DSA and ML-KEM), SLH-DSA identities would remain secure for authentication.

The tradeoff is signature size: at ~30 KB per signature, SLH-DSA signatures are roughly 6× larger than ML-DSA-87 signatures (4.6 KB). Key sizes go in the opposite direction — SLH-DSA public keys are tiny (64 bytes) vs ML-DSA-87 (2,592 bytes).

## Stateless vs Stateful Hash-Based Signatures

SLH-DSA is a **stateless** hash-based scheme, meaning the private key does not change between signatures. This is a deliberate design choice over the earlier **stateful** schemes XMSS ([[source-rfc-8391]]) and LMS, which NIST first approved for federal use in [[source-sp-800-208]]. Stateful schemes produce much smaller signatures (~2.8 KB for XMSS-SHA2\_20\_256) but require that a one-time key index is persisted to non-volatile storage before every signature — reusing a key index completely breaks security. SP 800-208 mandates hardware cryptographic modules (FIPS 140-3 Level 3+) to enforce this. SLH-DSA eliminates this operational burden entirely, at the cost of larger signatures, making it suitable for general-purpose software deployments like EBP.

## Fingerprint Role

The signing public key forms the **left leaf** of the identity merkle tree. It is hashed as `SHA-256(base64-decoded public key bytes)`. Identities using SLH-DSA receive the bech32 human-readable prefix **`ebpsk`** (SPHINCS+ + Kyber). See [[identity-model]].

## Implementation Details

- Supported variants: all `slh_dsa_*` variants exposed by the noble library (SHA-2 and SHAKE, "s" and "f" forms).
- Public keys are stored as base64-encoded strings.
- Public-key-only instances can be created via `SphincsSigningKey.fromPublicKey()` — these can verify but not sign.

## Related Pages

- [[identity-model]]
- [[source-fips-205]]
- [[source-rfc-8391]]
- [[source-sp-800-208]]
- [[ml-dsa]]
- [[ml-kem]]
- [[revocation-system]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Sphincs.ts`
- `wiki/raw/NIST.FIPS.205.pdf` → [[source-fips-205]]
- `wiki/raw/rfc8391.txt` → [[source-rfc-8391]]
- `wiki/raw/NIST.SP.800-208.pdf` → [[source-sp-800-208]]
