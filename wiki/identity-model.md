---
title: "EBP Identity Model"
type: concept
status: active
last_updated: 2026-04-08
source_count: 4
tags:
  - identity
  - fingerprint
  - keys
  - merkle
  - bech32
---

# EBP Identity Model

EBP identities are explicitly dual-key: every identity pairs a **signing key** (authenticity/integrity) with an **encryption/KEM key** (confidentiality). This model is central to EBP and avoids treating encryption and signatures as interchangeable capabilities.

## Key Pairings

The signing key type is chosen at identity generation time. The encryption key type is always Kyber.

| Signing Scheme | Encryption Scheme | Fingerprint Prefix |
|---|---|---|
| ML-DSA (`dilithium`) | ML-KEM (`kyber`) | `ebpdk1...` |
| SLH-DSA (`sphincs`) | ML-KEM (`kyber`) | `ebpsk1...` |

See [[ml-dsa]], [[slh-dsa]], and [[ml-kem]] for scheme details.

## Fingerprint Construction

The fingerprint is a bech32-encoded merkle root of the two public keys:

1. **Left leaf:** `SHA-256(base64-decoded signing public key bytes)` — computed by `computeSigningLeafRaw()`.
2. **Right leaf:** `SHA-256(hex-encoded encryption public key string bytes)` — computed by `computeEncryptionLeafRaw()`.
3. **Root:** `SHA-256(leftLeaf || rightLeaf)` — a two-leaf merkle tree.
4. **Encoding:** bech32 with scheme-specific HRP: `ebpdk` for Dilithium+Kyber, `ebpsk` for SPHINCS++Kyber.

The merkle tree design means the fingerprint can be verified without both keys present — only the leaf hash of the missing key plus the sibling hash are needed. This is useful in bandwidth-constrained scenarios.

Implementation: `core/Fingerprint.ts`

## Identity Storage

Identities are stored in `~/.ebp/<name>.identity.json` using a v2 storage format:

- **Public data** (unencrypted): fingerprint, key types, public keys, variants, details, revocation state.
- **Private keys** (AES-encrypted): signing and encryption private keys, encrypted with a user password.

This split allows reading public data (for display, verification) without decrypting private keys. Implementation: `Identity.toStorageFormat()` / `Identity.fromStorageFormat()` in `core/Identity.ts`.

## Details System

Identities can have attached **details** — key-value pairs like `name`, `email`, etc. Each detail is:

1. Signed with the identity's signing key (creating a proof record with nonce, timestamp, and signature).
2. Stored as `[detail_value, hex_encoded_proof]` in the details map.
3. Nonces are monotonically increasing to prevent replay.
4. Timestamps must be strictly increasing when ordered by nonce.

Details can be published to the [[component-server|server]] and verified by anyone with the identity's public signing key.

## Opaque Details

Details can be marked as **opaque** (prefixed with `opaque::`). For opaque details, only `SHA-256(value)` is stored — the cleartext value is never published. This allows verification that an email is associated with an identity without exposing the email to the public server.

## Revocation Integration

See [[revocation-system]] for how identities and individual details can be revoked using signed certificates.

## Related Pages

- [[ml-dsa]]
- [[slh-dsa]]
- [[ml-kem]]
- [[revocation-system]]
- [[component-cli]]
- [[component-gui]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Identity.ts`
- `core/Fingerprint.ts`
- `core/ExternalIdentity.ts`
