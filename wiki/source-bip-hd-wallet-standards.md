---
title: "Bitcoin BIPs 32/39/43/44 — HD wallets and mnemonics (source summary)"
type: source-summary
status: active
last_updated: 2026-05-23
source_count: 4
tags:
  - bitcoin
  - bip-32
  - bip-39
  - bip-43
  - bip-44
  - key-derivation
  - backup
  - ux
  - comparison
---

# Bitcoin BIPs 32/39/43/44 — HD wallets and mnemonics

This page summarizes four deployed Bitcoin Improvement Proposals (BIPs) kept under `wiki/raw/` as **comparison material**. EBP is not a cryptocurrency or blockchain system; it does not implement these BIPs. The value for EBP is in **key-management vocabulary**, **backup and recovery UX patterns**, **namespace/interoperability discipline**, and **cautions about partial key disclosure**—analogous problems appear in any system that manages long-lived asymmetric keys and human backup flows.

## Sources

- `wiki/raw/bip-0032.mediawiki` — BIP 32: Hierarchical Deterministic Wallets (informational; secp256k1-specific derivation).
- `wiki/raw/bip-0039.mediawiki` — BIP 39: Mnemonic code for generating deterministic keys.
- `wiki/raw/bip-0043.mediawiki` — BIP 43: Purpose field for deterministic wallets.
- `wiki/raw/bip-0044.mediawiki` — BIP 44: Multi-account hierarchy for deterministic wallets.

## BIP 32 — hierarchical deterministic (HD) keys

- **Model**: A tree of keypairs is derived from a single seed using HMAC-SHA512-based child key derivation (`CKDpriv` / `CKDpub`), with **chain codes** bundled into “extended” keys so children are not determined by the bare key alone.
- **Hardened vs normal children**: Indices ≥ 2^31 denote hardened derivation. **Non-hardened** derivation allows deriving child **public** keys from an extended **public** key alone (useful for receive-only servers). **Hardened** derivation breaks that equivalence and is used where compromise of a child must not enable climbing toward the parent.
- **Critical security note (from BIP32)**: Knowledge of a **parent extended public key** plus **any non-hardened descendant private key** is equivalent to knowing the **parent extended private key**, and thus the whole subtree below that parent. Extended public keys must therefore be protected more like secrets than single public keys.
- **Master generation**: Master keys are produced from a seed (recommended 256 bits from a CSPRNG) via HMAC-SHA512 with the literal key `"Bitcoin seed"`—a domain-separation choice specific to this ecosystem.
- **Default wallet layout (advisory)**: Accounts under hardened indices, each with external vs internal chains—patterns for separating “published receive material” from “internal-only” keys.

## BIP 39 — mnemonics and seed extraction

- **Goal**: Encode initial entropy (128–256 bits, multiple of 32) as a **word list**, with a checksum derived from the first `ENT/32` bits of SHA256(entropy). Words index 11-bit groups into a fixed wordlist.
- **Not brainwallets**: The motivation section states the format is meant to transport **computer-generated** randomness in human-readable form, **not** to hash user-chosen phrases into seeds.
- **Mnemonic → seed**: PBKDF2-HMAC-SHA512 with **2048** iterations; password = UTF-8 NFKD mnemonic; salt = UTF-8 NFKD `("mnemonic" + optional passphrase)`; output **512 bits**. Optional passphrase yields a different valid seed (BIP39 describes this as **plausible deniability** in the sense that every passphrase maps to some wallet, not that any particular policy holds for EBP).
- **Wordlist UX**: Ideal properties called out include prefix disambiguation (first four letters), avoiding confusable pairs, sorted lists for lookup, and NFKD encoding for non-ASCII lists. **Non-English generation is strongly discouraged** in the spec because mainstream wallet support is English-centric; localized lists are pointed to rather than ad-hoc invention.

## BIP 43 — purpose field (interop by convention)

- **Problem**: “BIP32 compatible” is underspecified because implementers can choose incompatible tree shapes.
- **Fix**: Reserve the **first hardened level** after the master as `purpose'`, where the purpose constant is tied to a **spec number** (e.g. BIP44 uses `44'`). Reserved ranges (e.g. 10001–19999 for SLIPs) separate community schemes.
- **Serialization note**: When the same derivation could serve unrelated domains, BIP43 suggests fixed xpub/xprv version bytes rather than per-network magics—an explicit choice favoring generic tooling over chain-specific typing at that layer.

## BIP 44 — multi-account hierarchy (application of BIP43)

- **Path template**: `m / purpose' / coin_type' / account' / change / address_index` with hardened levels through `account'` per the document.
- **Separation of concerns**: Coin type isolates subtrees per asset; account level separates user identities; change distinguishes external (user-visible) vs internal chains; address index enumerates keys.
- **Account rules**: Software should avoid creating a new account if the previous account has never been used on-chain; import uses **account discovery** scanning external chains.
- **Gap limit**: Default **20** consecutive unused external addresses stops search; wallets should warn if users exceed the gap—this is a concrete **UX + state recovery** pattern for any “sequence of published identifiers” design.

## Relevance to EBP (interpretive)

- **Selective capability**: BIP32’s split between “can derive public receive material” vs “can spend” is a general pattern for **least-privilege key handles**; EBP’s surfaces differ (PQ identities, details, revocation), but the *principle* of not handing signing power to display-only components remains analogous.
- **Namespace discipline**: BIP43’s purpose field is a lesson in **documenting derivation or identity namespaces** so “compatible” implementations cannot silently fork logical structure.
- **Human backup**: BIP39’s checksum, fixed wordlist properties, and explicit “not for brainwallets” guidance inform how to think about **paper backup** and **recovery phrase** UX without importing PBKDF2 parameters or wordlists into EBP protocols.
- **Discovery and limits**: BIP44’s gap limit and account discovery illustrate how **client state** and **published identifier sequences** interact—useful when designing import, sync, or “how many unused slots do we scan?” behavior in non-blockchain clients.

Full per-BIP application and advantage analysis for EBP: [[analysis-bip-patterns-for-ebp]].

## Boundaries and uncertainty

- **Cryptography**: BIP32’s math and encodings are **secp256k1-specific**; EBP’s keys follow ML-KEM / ML-DSA / SLH-DSA (and planned FN-DSA) per project docs—do not assume algorithmic compatibility.
- **BIP39 comments**: The raw BIP39 header includes a `Comments-Summary: Unanimously Discourage for implementation` field from the BIPs process; treat that as **process metadata** about review sentiment, not as a statement that deployed wallets avoid BIP39. EBP documentation should not over-interpret that line without checking current BIP comments.

## Related wiki pages

- [[analysis-bip-patterns-for-ebp]] — per-BIP application to PQ identities, advantages, and open design questions.
- [[key-management]] — where these lessons are tied to EBP’s lifecycle framing.
- [[identity-model]] — project-specific identity structure (not HD paths).
- [[random-bit-generation]] — entropy and CSPRNG context adjacent to mnemonic generation discussions.
