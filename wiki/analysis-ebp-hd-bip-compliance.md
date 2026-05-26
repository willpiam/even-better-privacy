---
title: "EBP-HD BIP Compliance Language"
type: analysis
status: active
last_updated: 2026-05-25
source_count: 8
tags:
  - bip-32
  - bip-39
  - bip-43
  - bip-44
  - compliance
  - ebp-hd
  - key-derivation
---

# EBP-HD BIP Compliance Language

## Verdict

EBP-HD should **not** be described as generally BIP32/39/43/44 compliant.
The conformance target is **`ebp-hd-v1`**, with BIP39-English mnemonic-format
compatibility as one narrow imported surface. The accurate public claim is:

> EBP-HD uses the canonical BIP39 English wordlist, BIP39 entropy/checksum
> mnemonic mechanics, and BIP32/43/44-inspired HD structure, but it is an
> EBP-specific deterministic identity scheme with EBP-specific seed extraction,
> path namespace, and PQ leaf derivation.

The strongest BIP compatibility claim is **BIP39-English mnemonic format
compatibility** for wordlist/checksum validation. All other conformance claims
should point to `ebp-hd-v1`. EBP-HD is deliberately **not BIP39
seed-compatible** with Bitcoin wallets because `mnemonicToSeed()` uses the
EBP-domain-separated salt `ebp-mnemonic-v2:` rather than BIP39's `"mnemonic" ||
passphrase` salt.

## Compliance Matrix

| Standard | EBP-HD status | Safe wording | Avoid saying |
| --- | --- | --- | --- |
| BIP32 | Not compliant | BIP32-inspired tree/node structure | BIP32 compliant, xpub-compatible |
| BIP39 | Partially compatible at mnemonic encoding/validation layer only | Uses BIP39 English words and checksum; EBP-specific seed extraction | BIP39 seed-compatible, Bitcoin-wallet compatible |
| BIP43 | Conceptually follows purpose-namespace discipline | BIP43-style EBP purpose namespace | BIP43 compliant unless the namespace is formally specified/registered as such |
| BIP44 | Not compliant | BIP44-style account/change/index layout and gap-limit discovery | BIP44 compliant |

## Permanent vs Addressable Gaps

Some differences are structural non-goals and should not be closed:

- **BIP32 secp256k1 CKD**: EBP-HD derives ML-DSA or SLH-DSA signing seeds plus
  ML-KEM seeds. Reusing BIP32 `CKDpriv` / `CKDpub` would derive the wrong
  cryptographic object for EBP.
- **xpub/xprv compatibility**: EBP-HD v1 exposes no extended-public-key API.
  Adding public-only derivation would be a new `ebp-hd-v2` design question, not
  a compatibility patch.
- **BIP39 seed compatibility**: EBP intentionally uses `ebp-mnemonic-v2:` as the
  PBKDF2 salt prefix so EBP mnemonics cannot be silently imported into Bitcoin
  wallets as the same seed.
- **Literal BIP44 wallet semantics**: EBP has no `coin_type'`, addresses,
  change outputs, or on-chain account discovery. The account/change/index shape
  is a useful recovery and UX pattern, not a wallet namespace.

Other gaps are worth tightening inside `ebp-hd-v1`:

- Maintain canonical test vectors for mnemonic validation, seed extraction,
  path parsing, leaf derivation, and resulting fingerprints.
- Treat the `m/ebp'/profile'/account'/change/index` path grammar and `0x454250`
  purpose constant as versioned `ebp-hd-v1` protocol surface.
- Document discovery defaults, especially the gap limit, as EBP behavior rather
  than BIP44 compliance.
- Keep user-facing copy explicit: BIP39 English words and checksum, not a
  Bitcoin wallet seed.

## Evidence

[[source-bip-hd-wallet-standards]] summarizes the imported BIP source material as
comparison material and explicitly states that EBP is not a blockchain system and
does not implement those BIPs wholesale. It identifies BIP32's secp256k1-specific
child-key derivation and xpub/xprv model, BIP39's exact PBKDF2 seed extraction
salt, BIP43's first hardened purpose convention, and BIP44's five-level wallet
path.

[[ebp-hd]] documents the active EBP implementation as "inspired by
BIP32/39/43/44" rather than compliant with them. It says EBP mnemonics use the
canonical BIP39 English 2048-word list, checksum, and 11-bit grouping, but seed
extraction uses the EBP salt prefix `ebp-mnemonic-v2:` so identical words and
passphrases produce different seeds in EBP and Bitcoin tooling.

`docs/ebp-hd-spec.md` repeats this boundary in spec form: EBP-HD adapts
BIP32/39/43/44 structural lessons, does not reuse Bitcoin secp256k1 child-key
math, and feeds deterministic seed material into existing PQ key generators. The
spec's compatibility section says EBP-HD uses BIP39 English wordlist/checksum
rules, does not use BIP39's seed salt, and does not use BIP32 secp256k1
derivation.

`core/Mnemonic.ts` implements the BIP39-like mnemonic format: 128-256 bits of
entropy, `ENT / 32` checksum bits from SHA-256, 11-bit word indices, and the
canonical BIP39 English wordlist. The same file implements EBP seed extraction
with PBKDF2-HMAC-SHA512, 2048 iterations, 64-byte output, and salt
`ebp-mnemonic-v2:` plus the normalized passphrase.

`core/HdPath.ts` defines an EBP-specific path namespace:

```text
m/ebp'/profile'/account'/change/index
```

The first segment is an EBP-private purpose constant (`0x454250`, ASCII "EBP"),
not BIP44's `44'` purpose. The `profile'` segment is `dilithium'` or `sphincs'`,
not a BIP44 `coin_type'`.

`core/Hd.ts` derives master and child node material with HKDF-SHA512 and EBP
domain tags, then expands leaves into one signing seed and one ML-KEM seed. This
resembles the HD-tree idea but is not BIP32 `CKDpriv` / `CKDpub` and exposes no
extended-public-key API.

## Practical Public Language

Good:

- "EBP-HD uses BIP39 English words and checksum mechanics for mnemonic backup."
- "EBP-HD is inspired by BIP32/43/44 HD wallet structure, adapted to post-quantum
  EBP identities."
- "EBP-HD phrases are not interchangeable with Bitcoin wallet seeds."
- "EBP-HD is compatible with its own `ebp-hd-v1` test vectors."

Avoid:

- "BIP32 compliant."
- "BIP39 compliant" without qualification.
- "BIP44 compliant."
- "Compatible with Bitcoin wallets."
- "Supports xpub/xprv."

## Blockchain Comparison

A blockchain can often claim BIP compatibility when it preserves the relevant
BIP mechanics and only assigns its own network or coin namespace. For example, a
wallet ecosystem that keeps BIP39 seed extraction, BIP32 child-key derivation,
and the BIP44 path template with its own `coin_type'` can reasonably describe
itself as BIP39/BIP32/BIP44 compatible for those surfaces.

EBP-HD made stronger intentional changes: EBP-specific PBKDF2 salt,
PQ-specific leaf expansion, EBP-specific purpose/profile path segments, no
secp256k1 CKD, and no xpub/xprv. That makes "compliant with these BIPs" too
broad. The right framing is **BIP39-English mnemonic format compatibility plus
BIP32/43/44-derived design patterns inside an EBP-HD specification**.

## Sources

- [[source-bip-hd-wallet-standards]]
- [[ebp-hd]]
- [[analysis-bip-patterns-for-ebp]]
- [[key-management]]
- `docs/ebp-hd-spec.md`
- `core/Mnemonic.ts`
- `core/HdPath.ts`
- `core/Hd.ts`
