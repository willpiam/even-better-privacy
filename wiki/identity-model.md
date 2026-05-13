---
title: "EBP Identity Model"
type: concept
status: active
last_updated: 2026-05-11
source_count: 8
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

1. **Left leaf:** `SHA-256(base64-decoded signing public key bytes)` — computed by `computeSigningLeafRaw()`. The on-disk/on-wire form is standard RFC 4648 Base64 (Table 1), not base64url, unless documented otherwise; see [[source-rfc-4648]].
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

### Updating a Detail

Each detail path (e.g. `email`, `name`) can only hold one active value at a time. **To change a detail you must revoke the existing value first, then set the new one.** The server enforces this: pushing a detail to a path that already has an unrevoked value returns a 409 Conflict error. Once the old detail is revoked (see [[revocation-system]]), the server accepts a new value at the same path.

Workflow to update a detail:

1. Revoke the old value — e.g. `ebp revoke-detail email --push`
2. Set the new value — e.g. `ebp detail email newemail@example.com --push`

This two-step design creates an auditable trail via signed revocation certificates and prevents silent detail replacement.

## Opaque Details

Details can be marked as **opaque** (prefixed with `opaque::`). For opaque details, only `SHA-256(value)` is stored — the cleartext value is never published. This allows verification that an email is associated with an identity without exposing the email to the public server.

## Revocation Integration

See [[revocation-system]] for how identities and individual details can be revoked using signed certificates.

## Standards Context

EBP identities are not OpenPGP keys, X.509 certificates, or W3C DIDs. The OpenPGP PQC draft summarized in [[source-draft-ietf-openpgp-pqc-17]] uses OpenPGP packet and certificate semantics, while RFC 5280 summarized in [[source-rfc-5280]] uses X.509 subjects, issuers, extensions, and certification paths. DID v1.1 summarized in [[source-did-1-1]] resolves URI-based identifiers to DID documents with method-defined verification methods and services. EBP instead identifies a fixed dual-key object by a bech32-encoded Merkle root.

NIST SP 800-57 Part 1's key lifecycle vocabulary is useful for future identity expiry, rotation, compromise, and destruction work. See [[key-management]].

## Related Pages

- [[ml-dsa]]
- [[slh-dsa]]
- [[ml-kem]]
- [[message-payload-formats]]
- [[revocation-system]]
- [[key-management]]
- [[decentralized-identifiers]]
- [[openpgp-pqc]]
- [[x509-pki]]
- [[component-cli]]
- [[component-gui]]
- [[overview]]

## Sources

- `ReadMe.md`
- `core/Identity.ts`
- `core/Fingerprint.ts`
- `core/ExternalIdentity.ts`
- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
- `wiki/raw/rfc5280.txt` → [[source-rfc-5280]]
- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]]
- `wiki/raw/rfc4648.txt` → [[source-rfc-4648]]
