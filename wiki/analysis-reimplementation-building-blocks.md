---
title: "Analysis: Reimplementation Building Blocks"
type: analysis
status: active
last_updated: 2026-05-06
source_count: 13
tags:
  - analysis
  - interoperability
  - reimplementation
  - crypto
  - encoding
---

# Reimplementation Building Blocks

This page is a language-port checklist for EBP. It inventories the critical primitives, encodings, and deterministic transforms that must match EBP input/output behavior.

## Goal

Before implementing workflows, a new-language port should first confirm it can reproduce all required mappings below exactly (byte-for-byte where noted).

## Critical Crypto Libraries and Primitives

| Category | EBP usage | Required capability for a port |
|---|---|---|
| PQ KEM | ML-KEM-1024 (`@noble/post-quantum/ml-kem`) | Encapsulate/decapsulate with identical ciphertext/shared-secret behavior |
| PQ signatures | ML-DSA-87, SLH-DSA-SHA2-256s (`@noble/post-quantum/ml-dsa`, `@noble/post-quantum/slh-dsa`) | Sign/verify over exact envelope bytes |
| Symmetric AEAD | AES-256-GCM (`@noble/ciphers/aes`) | Encrypt/decrypt with 96-bit nonce and tag-compatible output |
| Hashing | SHA-256 (`@noble/hashes/sha2`) | Digest over UTF-8 and raw bytes depending on call site |
| KDF | PBKDF2-HMAC-SHA256 + Argon2id (`@noble/hashes/pbkdf2`, `@noble/hashes/argon2`) | Derive 32-byte keys with matching parameters by ciphertext version |
| Fingerprint encoding | Bech32 (`bech32`) | Encode/decode 32-byte root with `ebpdk`/`ebpsk` HRPs |

## Runtime Crypto Operations Used

These are platform/runtime operations used directly in addition to noble-based primitives:

- `crypto.getRandomValues(...)` for random bytes/nonces/salts/tokens.
- `crypto.subtle.digest("SHA-256", ...)` in browser-facing hashing paths.
- `crypto.subtle.importKey(...)`, `crypto.subtle.sign(...)` in CLI state-signing helper paths.
- `crypto.subtle.deriveKey(...)`, `crypto.subtle.encrypt(...)`, `crypto.subtle.decrypt(...)` in GUI mail-account secret handling.
- `crypto.randomUUID()` for opaque identifiers (not cryptographic protocol semantics, but present in operational/test paths).

## Deterministic Mappings That Must Match

### 1) Signature envelopes

Ports must match envelope string construction exactly before signing/verifying.

- Purpose envelopes (`core/MessageHash.ts`):
  - `ebp::message::v1::{sha256(message)}::{salt}`
  - `ebp::detail-proof::v1::{sha256(message)}::{salt}`
  - `ebp::revocation::v1::{sha256(message)}::{salt}`
  - `ebp::hierarchy::v1::{sha256(message)}::{salt}`
- Recipient-bound envelope (v2):
  - `ebp::messagehash::v2::{recipientFingerprint}::{sha256(message)}::{salt}`
- Multi-recipient envelope (v3):
  - Canonical JSON over `message`, sorted recipient fingerprints, sorted attachment manifest; then `ebp::messagehash::v3::{sha256(canonicalJson)}::{salt}`.

### 2) Identity fingerprint derivation

Fingerprint must be reproduced exactly:

1. `left = sha256(base64_decode(signingPublicKey))`
2. `right = sha256(hex_decode(encryptionPublicKey))`
3. `root = sha256(left || right)`
4. `fingerprint = bech32_encode(hrp, root)` where `hrp` is:
   - `ebpdk` for `dilithium + kyber`
   - `ebpsk` for `sphincs + kyber`

### 3) Ciphertext framing for identity storage AES blobs

`core/AES.ts` uses:

- Binary layout: `[version(1) | salt(16) | iv(12) | ciphertext_with_tag]`
- Then base64 encodes the full byte array.
- Key derivation by version:
  - v1: PBKDF2-SHA256, 310000 iterations, `dkLen=32`
  - v2: PBKDF2-SHA256, 600000 iterations, `dkLen=32`
  - v3+: Argon2id, `m=64MiB`, `t=3`, `p=1`, `dkLen=32`

### 4) Message payload binary/text encoding expectations

- Hex encoding: lowercase two-char-per-byte (`toHex` / `hexToBytes`).
- Hex parsing rejects odd length and non-hex chars.
- Base64 encoding for signing keys/signatures in signed payload contexts.
- UTF-8 encoding (`TextEncoder`) before hash/sign-envelope construction.

### 5) Canonical JSON for signed structures

Where signed payloads are structured objects (detail proofs, revocations, hierarchy certs, state transitions), serialization must be deterministic via canonical/stable key ordering (`stableStringify` / `canonicalJsonStringify`).

## Porting Capability Checklist

A target language/toolset is "ready" if it can provide all of:

- ML-KEM-1024, ML-DSA-87, and SLH-DSA-SHA2-256s primitives.
- AES-256-GCM with explicit nonce and optional AAD support.
- SHA-256 on bytes and UTF-8 strings.
- PBKDF2-HMAC-SHA256 and Argon2id with tunable parameters.
- Bech32 with custom HRP support.
- Strict hex/base64 conversion utilities.
- Deterministic canonical JSON serialization.
- CSPRNG equivalent to `crypto.getRandomValues`.

## Non-goals / clarifications

- `crypto.randomUUID()` usage is operational (IDs/temp names), not a wire-format compatibility primitive.
- SMTP/IMAP transport standards are integration boundaries, not cryptographic mapping primitives.

## Related Pages

- [[analysis-noble-library-usage]]
- [[identity-model]]
- [[message-payload-formats]]
- [[ml-kem]]
- [[ml-dsa]]
- [[slh-dsa]]
- [[aes-gcm]]
- [[random-bit-generation]]
- [[component-website]]

## Sources

- `core/MessageHash.ts`
- `core/Fingerprint.ts`
- `core/AES.ts`
- `core/StateHash.ts`
- `core/CanonicalJson.ts`
- `core/Hex.ts`
- `core/Base64.ts`
- `cli/utils.ts`
- `gui/local-backend/mail-account.ts`
- `gui/js/crypto-utils.js`
- `website/verify.js`
- `wiki/analysis-noble-library-usage.md`
- `wiki/message-payload-formats.md`
