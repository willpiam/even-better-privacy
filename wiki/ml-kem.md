---
title: "ML-KEM (Kyber) in EBP"
type: entity
status: active
last_updated: 2026-04-08
source_count: 3
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

## Implementation Details

- Supported variants: `ml_kem512`, `ml_kem768`, `ml_kem1024` (all exposed by the library, only 1024 used by default).
- Ciphertext sizes are tracked in `CIPHERTEXT_SIZES` for proper parsing during decryption.
- Public-key-only instances can be created via `KyberEncryptionKey.fromPublicKey()` — these can encrypt but not decrypt.

## Fingerprint Role

The encryption (KEM) public key forms the **right leaf** of the identity merkle tree. It is hashed as `SHA-256(hex-encoded public key)` and combined with the signing key leaf to produce the identity [[identity-model|fingerprint]].

## Related Pages

- [[identity-model]]
- [[message-payload-formats]]
- [[source-fips-203]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[component-cli]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Kyber.ts`
- `wiki/raw/NIST.FIPS.203.pdf` → [[source-fips-203]]
