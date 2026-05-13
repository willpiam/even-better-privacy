---
title: "ML-DSA (Dilithium) in EBP"
type: entity
status: active
last_updated: 2026-05-11
source_count: 5
tags:
  - crypto
  - signatures
  - dilithium
  - lattice
---

# ML-DSA (Dilithium)

ML-DSA (Module-Lattice-Based Digital Signature Algorithm) is one of two signing schemes supported by EBP. It is standardized as NIST FIPS 204, derived from the CRYSTALS-Dilithium submission. See [[source-fips-204]] for the full standard summary.

## Variant Used

EBP uses **ML-DSA-87** (`ml_dsa87`), the highest security parameter set (NIST Security Category 5):

| Property | Value |
|---|---|
| Public key size | 2,592 bytes |
| Secret key size | 4,896 bytes |
| Signature size | 4,627 bytes |

The default variant is set in `core/Dilithium.ts` via `DilithiumSigningKey(variant = "ml_dsa87")`. The implementation uses the `@noble/post-quantum/ml-dsa` library.

## Role in EBP

ML-DSA provides authentication and integrity in EBP's dual-key [[identity-model]]:

- **Message signing:** signs a hash envelope of the message (with optional salt) to produce a signature.
- **Detail proofs:** each attached detail (name, email, etc.) is signed with ML-DSA to create a verifiable proof.
- **Revocation certificates:** revocation certificates are signed with the identity's signing key. See [[revocation-system]].
- **State transitions:** publishing to the server requires signing a state-transition message.

## Compared to SLH-DSA

ML-DSA and [[slh-dsa]] serve the same role in EBP (signing). The user chooses at identity generation time:

| Property | ML-DSA-87 | SLH-DSA-SHA2-256s |
|---|---|---|
| Public key | 2,592 bytes | 64 bytes |
| Signature | 4,627 bytes | 29,792 bytes |
| Security basis | Lattice (MLWE/MSIS) | Hash functions only |
| Speed | Faster signing/verifying | Slower |

ML-DSA offers compact signatures but relies on lattice assumptions. SLH-DSA offers minimal assumptions (hash-only) but produces much larger signatures.

## OpenPGP PQC Context

The IETF OpenPGP PQC draft profiles ML-DSA in composite OpenPGP signatures such as ML-DSA-87+Ed448. EBP uses ML-DSA-87 directly as one of its signing-key choices and does not use OpenPGP signature packets. See [[openpgp-pqc]] and [[source-draft-ietf-openpgp-pqc-17]].

## Fingerprint Role

The signing public key forms the **left leaf** of the identity merkle tree. It is hashed as `SHA-256(base64-decoded public key bytes)`. Identities using ML-DSA receive the bech32 human-readable prefix **`ebpdk`** (Dilithium + Kyber). See [[identity-model]].

## Implementation Details

- Supported variants: `ml_dsa44`, `ml_dsa65`, `ml_dsa87` (only 87 used by default).
- Public keys are stored as base64-encoded strings (RFC 4648 Table 1 alphabet; see [[source-rfc-4648]]).
- Public-key-only instances can be created via `DilithiumSigningKey.fromPublicKey()` — these can verify but not sign.

## Related Pages

- [[identity-model]]
- [[source-fips-204]]
- [[source-draft-ietf-openpgp-pqc-17]]
- [[slh-dsa]]
- [[ml-kem]]
- [[openpgp-pqc]]
- [[revocation-system]]
- [[component-cli]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Dilithium.ts`
- `wiki/raw/nist.fips.204.pdf` → [[source-fips-204]]
- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
- `wiki/raw/rfc4648.txt` → [[source-rfc-4648]]
