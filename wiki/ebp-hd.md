---
title: "EBP-HD Deterministic Hierarchical Identities"
type: concept
status: active
last_updated: 2026-05-25
source_count: 11
tags:
  - hd
  - key-derivation
  - mnemonic
  - identity
  - bip-32
  - bip-39
  - bip-43
  - bip-44
---

# EBP-HD Deterministic Hierarchical Identities

EBP-HD is an opt-in deterministic identity layer inspired by BIP32/39/43/44
structure. It derives normal EBP dual-key identities from a mnemonic-backed
master seed. Existing non-HD identities remain valid and are not imported into
the HD tree.

## Model

- Mnemonics use the canonical BIP39 English 2048-word list with BIP39 checksum
  and 11-bit grouping.
- `mnemonicToSeed()` uses PBKDF2-HMAC-SHA512 with the domain salt prefix
  `ebp-mnemonic-v2:`. This deliberately differs from BIP39's Bitcoin-wallet
  seed salt, so the same words and passphrase do not produce the same seed in
  EBP and Bitcoin tooling.
- HD paths use `m/ebp'/profile'/account'/change/index`, where profile is
  `dilithium` or `sphincs`.
- Leaf expansion derives one signing seed and one ML-KEM seed; the resulting
  keys are fingerprinted by the existing [[identity-model]] Merkle-root bech32
  construction.
- HD-derived identities include optional `hdProvenance` in public storage so
  clients can display and rediscover the derivation path.

## Conformance

EBP-HD conforms to `ebp-hd-v1`, specified in `docs/ebp-hd-spec.md` and pinned by
canonical vectors in `core/tests/fixtures/ebp-hd/test-vectors.json`. Its only BIP
compatibility claim is the mnemonic format surface: BIP39 English words,
checksum, and 11-bit grouping. Seed extraction, path namespace, node derivation,
and PQ leaf expansion are EBP-specific and should be described as
BIP32/43/44-inspired rather than BIP-compliant.

## Implementation

- `core/Mnemonic.ts` implements mnemonic generation, validation, entropy
  recovery, and seed extraction.
- `core/HdPath.ts` implements EBP path parsing and formatting.
- `core/Hd.ts` implements master node, child node, account node, and leaf seed
  derivation.
- `core/Identity.ts` supports optional deterministic seeds and
  `Identity.fromAccount()`.
- `cli/commands/hd.ts` adds `ebp hd generate-mnemonic`, `verify-mnemonic`,
  `derive`, `new-identity`, and `discover`.
- `gui/local-backend/routes.ts` exposes HD mnemonic, verification, identity
  derivation, and discovery endpoints.
- `gui/index.html` and `gui/app.js` expose a mnemonic-confirming HD identity
  creation flow.

## Boundaries

EBP-HD v1 exposes no extended-public-key API. Paths may use BIP44-style
non-hardened `change/index` notation, but derivation is performed from private
root material and does not create public derivation capability.

Server discovery checks derived fingerprints against the existing identity API.
Paths, account numbers, and mnemonic-derived metadata are not published to the
server.

## Sources

- `docs/ebp-hd-spec.md`
- `core/Mnemonic.ts`
- `core/bip39-english.ts`
- `core/Hd.ts`
- `core/HdPath.ts`
- `core/Identity.ts`
- `cli/commands/hd.ts`
- `gui/local-backend/routes.ts`
- `gui/app.js`
- `wiki/raw/bip-0039.mediawiki`
- [[analysis-bip-patterns-for-ebp]]
