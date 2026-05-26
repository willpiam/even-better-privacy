---
title: "Key Management Context"
type: concept
status: active
last_updated: 2026-05-24
source_count: 5
tags:
  - key-management
  - lifecycle
  - revocation
  - policy
---

# Key Management Context

Key management covers the lifecycle of keying material: generation, storage,
distribution, use, rotation, revocation, compromise handling, backup, recovery,
and destruction. NIST SP 800-57 is the main source family currently summarized
in the wiki for this topic.

## Source Roles

- [[source-sp-800-57-part-1-r5]] gives general lifecycle guidance, key states,
  cryptoperiod concepts, and security-strength planning.
- [[source-sp-800-57-part-2-r1]] covers organizational policy and cryptographic
  key management systems.
- [[source-sp-800-57-part-3-r1]] gives application-specific guidance for domains
  such as PKI, TLS, S/MIME, DNSSEC, and SSH, with a staleness caution for modern
  protocol choices.

## EBP Touchpoints

EBP's [[identity-model]] and [[revocation-system]] are the main project-specific
key-management surfaces:

- Private signing and encryption keys are stored separately from public identity
  data.
- Revocation certificates handle detail and whole-identity invalidation.
- Emergency revocation certificates are a recovery mechanism for loss or
  compromise scenarios.
- Future identity expiry, rotation, and hierarchy features should be documented
  with explicit key-state and cryptoperiod assumptions.
- Long-lived signature evidence should incorporate [[integrity-renewal]]
  practices so signatures remain verifiable across hash/algorithm transitions.

## Boundary

The NIST sources provide vocabulary and risk-management structure. They do not
make EBP a federal CKMS, and they do not replace the project-specific protocol
and storage documentation.

## Blockchain-adjacent patterns (non-EBP protocols)

Bitcoin’s widely deployed HD wallet BIPs ([[source-bip-hd-wallet-standards]])
illustrate **user backup**, **derivation-tree namespaces**, and
**partial-key-sharing** tradeoffs at ecosystem scale. EBP is not a blockchain
client and does not implement Bitcoin's secp256k1 CKD or xpub wire formats. EBP
conforms to its own [[ebp-hd]] `ebp-hd-v1` specification, which adapts those
structural ideas into mnemonic-backed deterministic PQ identities with an
EBP-specific path namespace. Lessons that transfer at the design level include:

- **Least-privilege handles**: Extended public keys that can derive further
  public identifiers must be treated as higher-impact than a single public key
  if any co-path private material could ever leak (see hardened-vs-normal
  discussion in [[source-bip-hd-wallet-standards]]).
- **Interop requires explicit structure**: A “deterministic hierarchy” without a
  documented top-level **purpose** or namespace invites incompatible
  implementations (BIP43’s motivation).
- **Recovery UX**: Checksummed human-readable backups, explicit warnings against
  “brainwallet” semantics, and **scan limits** (gap limits) for rediscovering
  used slots are UX patterns for any system that sequences published
  identifiers—analogous concerns can appear in import/sync flows even without
  addresses or chains.

For consolidated citations to the raw BIP files, see
[[source-bip-hd-wallet-standards]]. For a per-BIP analysis of how these patterns
apply to EBP (PQ leaves, backup, namespace, multi-account UX), see
[[analysis-bip-patterns-for-ebp]] and [[ebp-hd]].

## Related Pages

- [[source-sp-800-57-part-1-r5]]
- [[source-sp-800-57-part-2-r1]]
- [[source-sp-800-57-part-3-r1]]
- [[identity-model]]
- [[revocation-system]]
- [[cryptographic-algorithm-transitions]]
- [[integrity-renewal]]
- [[source-bip-hd-wallet-standards]]
- [[analysis-bip-patterns-for-ebp]]
- [[ebp-hd]]

## Sources

- `wiki/raw/NIST.SP.800-57pt1r5.pdf` → [[source-sp-800-57-part-1-r5]]
- `wiki/raw/NIST.SP.800-57pt2r1.pdf` → [[source-sp-800-57-part-2-r1]]
- `wiki/raw/NIST.SP.800-57Pt3r1.pdf` → [[source-sp-800-57-part-3-r1]]
- `wiki/raw/Long-lived-digital-integrity-using-short-lived-hash-functions.pdf` →
  [[source-long-lived-digital-integrity-using-short-lived-hash-functions]]
- `wiki/raw/bip-0032.mediawiki`, `bip-0039.mediawiki`, `bip-0043.mediawiki`,
  `bip-0044.mediawiki` → [[source-bip-hd-wallet-standards]]
