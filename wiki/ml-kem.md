---
title: "ML-KEM (Kyber) in EBP"
type: entity
status: active
last_updated: 2026-05-20
source_count: 8
tags:
  - crypto
  - kem
  - kyber
  - lattice
---

# ML-KEM (Kyber)

ML-KEM (Module-Lattice-Based Key-Encapsulation Mechanism) is the sole encryption/KEM scheme in EBP. It is standardized as NIST FIPS 203, derived from the CRYSTALS-Kyber submission. See [[source-fips-203]] for the full standard summary.

## Variant Used

EBP uses **ML-KEM-1024**, the highest security parameter set (NIST Security Category 5):

| Property | Value |
|---|---|
| Public key size | 1,568 bytes |
| Secret key size | 3,168 bytes |
| Ciphertext size | 1,568 bytes |
| Shared secret | 32 bytes |

The default variant is set in `core/Kyber.ts` via `KyberEncryptionKey(variant = "ml_kem1024")`. The implementation uses the `@noble/post-quantum/ml-kem` library.

## Role in EBP

ML-KEM provides the confidentiality layer in EBP's dual-key [[identity-model]]:

1. **Encapsulate:** generate a random 32-byte shared secret and a ciphertext bound to the recipient's public KEM key.
2. **Derive AES key:** the shared secret becomes the key for AES-256-GCM.
3. **Encrypt payload:** the message is encrypted with AES-256-GCM using a random 12-byte nonce.
4. **Transmit:** the ciphertext is `encapsulatedKey || nonce || aesCiphertext` (hex-encoded).

Decryption reverses this: decapsulate to recover the shared secret, then decrypt the AES payload.

## Per-Message Fresh Key Pattern

EBP generates a fresh shared secret for every message. Responses use a new encapsulation, not the key from the initial message. This is simpler than session-key negotiation and avoids key reuse across messages.

## Multi-Recipient Key Wrap Pattern

For multi-recipient native email, EBP uses ML-KEM as a key-encryption layer over a single AES-256 content key:

1. Generate one random 32-byte AES content key.
2. Encrypt message/attachments once with that content key (fresh nonce per ciphertext).
3. For each recipient identity, run ML-KEM encapsulation and use the resulting shared secret to AES-GCM-wrap the content key.
4. Store one wrap record per recipient: `{ fingerprint, kemCiphertext, keyWrapNonce, wrappedContentKey }`.

This keeps payload encryption cost constant while preserving recipient-specific KEM confidentiality.

## NIST backup KEM (HQC)

In March 2025 NIST selected **HQC** as a **backup** general-encryption KEM based on error-correcting codes, while reaffirming **ML-KEM as the primary recommended KEM** ([[source-nist-hqc-fifth-pq-encryption]]). EBP does not implement HQC; see [[hqc]] for standards timeline and diversification context.

## Standards Context

EBP's symmetric layer uses AES-256-GCM after ML-KEM encapsulation. AES is specified by [[source-fips-197]], while GCM nonce, tag, and associated-data semantics are specified by [[source-sp-800-38d]] and summarized in [[aes-gcm]].

The IETF OpenPGP PQC draft also profiles ML-KEM, but in composite OpenPGP KEMs such as ML-KEM-1024+X448. That is related context, not EBP's construction. See [[openpgp-pqc]] and [[source-draft-ietf-openpgp-pqc-17]].

## Implementation Details

- Supported variants: `ml_kem512`, `ml_kem768`, `ml_kem1024` (all exposed by the library, only 1024 used by default).
- Ciphertext sizes are tracked in `CIPHERTEXT_SIZES` for proper parsing during decryption.
- Public-key-only instances can be created via `KyberEncryptionKey.fromPublicKey()` — these can encrypt but not decrypt.

## Fingerprint Role

The encryption (KEM) public key forms the **right leaf** of the identity merkle tree. It is hashed as `SHA-256(hex-encoded public key)` and combined with the signing key leaf to produce the identity [[identity-model|fingerprint]].

## Related Pages

- [[identity-model]]
- [[message-payload-formats]]
- [[aes-gcm]]
- [[source-fips-203]]
- [[source-fips-197]]
- [[source-sp-800-38d]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[openpgp-pqc]]
- [[hqc]]
- [[source-nist-hqc-fifth-pq-encryption]]
- [[component-cli]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Kyber.ts`
- `core/MultiRecipientCipher.ts`
- `wiki/raw/NIST.FIPS.203.pdf` → [[source-fips-203]]
- `wiki/raw/NIST.FIPS.197-upd1.pdf` → [[source-fips-197]]
- `wiki/raw/nistspecialpublication800-38d.pdf` → [[source-sp-800-38d]]
- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
- `wiki/raw/NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption.md` → [[source-nist-hqc-fifth-pq-encryption]]
