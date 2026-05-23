---
title: "Even Better Privacy (EBP) Overview"
type: overview
status: active
last_updated: 2026-05-23
source_count: 26
tags:
  - ebp
  - overview
  - architecture
---

# Even Better Privacy (EBP)

EBP is a reference implementation of a post-quantum secure identity and messaging system. It is positioned as a successor pattern to PGP, built from the ground up with NIST-approved quantum-secure cryptographic schemes.

## Core Idea

Unlike legacy systems that often use one asymmetric scheme for multiple tasks, EBP models an identity as two distinct key capabilities:

- **Signing key** (authentication/integrity): [[ml-dsa]] or [[slh-dsa]]
- **Encryption/KEM key** (confidentiality): [[ml-kem]]

These always appear as a pair — never in isolation. The resulting object is called an **Identity**. The fingerprint is a bech32-encoded merkle root of the two public keys. See [[identity-model]] for full details.

## Cryptographic Direction

EBP uses NIST FIPS post-quantum standards:

| Scheme | Standard | Role | Variant Used |
|---|---|---|---|
| ML-KEM (Kyber) | FIPS 203 | KEM / Confidentiality | ML-KEM-1024 |
| HQC | (draft FIPS ~2026, final ~2027) | Backup KEM (not in EBP) | — |
| ML-DSA (Dilithium) | FIPS 204 | Signing / Auth | ML-DSA-87 |
| SLH-DSA (SPHINCS+) | FIPS 205 | Signing / Auth | SLH-DSA-SHA2-256s |
| FN-DSA (Falcon) | FIPS 206 (draft) | Signing / Auth | TBD |

All currently **implemented** EBP parameter sets target NIST Security Category 5. NIST selected [[hqc]] in March 2025 as a **backup** general-encryption KEM (code-based) alongside ML-KEM; EBP continues to use ML-KEM only ([[source-nist-hqc-fifth-pq-encryption]]). See [[source-fips-203]], [[source-fips-204]], [[source-fips-205]] for standard summaries. For background on the stateful hash-based predecessors (XMSS, LMS) that motivated SLH-DSA's stateless design, see [[source-rfc-8391]] and [[source-sp-800-208]].

EBP also uses AES-256-GCM for symmetric encryption after ML-KEM encapsulation. AES is specified by [[source-fips-197]] and GCM by [[source-sp-800-38d]]; see [[aes-gcm]] for how this applies to EBP payloads.

## Standards Boundaries

Some ingested standards are useful comparison material rather than EBP protocol definitions. [[openpgp-pqc]] covers the IETF OpenPGP PQC draft, which uses OpenPGP packets and composite algorithms instead of EBP's JSON payload format. [[x509-pki]] covers the X.509/PKIX model from [[source-rfc-5280]], which differs from EBP's self-contained fingerprinted identity model. [[hashcash-cost-functions]] summarizes Adam Back's hashcash proof-of-work proposal ([[source-hashcash-adam-back-2002]]) as historical email/DoS abuse throttling; EBP does not use hashcash stamps—see [[email-transport]] for how SMTP/IMAP carry PQ-signed payloads instead.

Other NIST sources provide policy and assurance vocabulary: [[key-management]] summarizes SP 800-57 lifecycle guidance, [[random-bit-generation]] summarizes SP 800-90 randomness guidance, [[cryptographic-algorithm-transitions]] summarizes SP 800-131A transition language, and [[cryptographic-module-validation]] distinguishes FIPS-standardized algorithms from FIPS 140-3 validated modules. [[source-bip-hd-wallet-standards]] captures Bitcoin BIP32/39/43/44 as **non-protocol** comparison material for backup UX, derivation-tree namespaces, and partial-key-sharing cautions (EBP is not a blockchain wallet; see [[key-management]]).

IETF and W3C infrastructure sources document the non-cryptographic layers EBP rides on or compares against: [[uri-syntax]] summarizes RFC 3986 URI parsing and normalization, [[email-transport]] summarizes SMTP transport ([[source-rfc-5321]]) and IMAP4rev2 mailbox access ([[source-rfc-9051]]), and [[decentralized-identifiers]] compares EBP identities with W3C DID v1.1 ([[source-did-1-1]]). These standards provide carriage, addressing, identity-system, and access semantics; EBP's end-to-end security remains in its own identities and payloads.

Binary fields embedded in JSON (for example PQ signing keys, signatures, and attachment `fileDataBase64`) use IETF **Base64** as defined in [[source-rfc-4648]] (Table 1 alphabet with `=` padding). That RFC also names **base64url**, a different alphabet; EBP wire formats use standard Base64 unless a field explicitly documents otherwise—see [[message-payload-formats]].

Gmail and Outlook mail in [[component-gui]] rely on provider **OAuth 2.0** (authorization code, refresh tokens, redirect-uri registration) documented in [[source-google-oauth2-web-server]], plus Google's **unverified-app** policy in [[source-google-cloud-unverified-apps]]. Google recommends **Cross-Account Protection (RISC)** security-event webhooks for Google-linked accounts ([[source-google-cross-account-protection-risc]]); EBP does not implement RISC yet.

## Main System Components

- [[component-cli]]: command-line interface for identity lifecycle and message/file operations.
- [[component-gui]]: browser-based GUI with local backend, plus native email integration.
- [[component-desktop]]: Tauri desktop shell and sidecar packaging for the GUI.
- [[component-server]]: key/discovery server and API for publish/fetch/revocation data.
- [[component-email-extension]]: Chrome extension for webmail encryption/signing workflows.
- [[component-mobile]]: React Native mobile app (under development, targeting GUI feature parity).

## How It Works

1. Generate an identity (creates a signing key + encryption key pair).
2. Share your public identity with others (fingerprint + public keys).
3. Import contacts' public identities.
4. Sign messages — recipients verify using your public signing key.
5. Encrypt messages (including native-email attachments in GUI flows) — recipients decrypt using their private encryption key.

For multi-recipient native email, EBP now supports a one-pass symmetric encryption pattern: one AES-256 content key encrypts the body and attachments, while ML-KEM encapsulates/wraps that content key separately for each recipient identity.

## Revocation and Trust Maintenance

EBP includes signed revocation certificates for both individual details and whole identities, with nonce handling to prevent replay attacks. Emergency revocation certificates can be pre-generated for loss/compromise scenarios. See [[revocation-system]].

## Project Shape

The repository is organized as a multi-surface implementation:

- `core/` — shared crypto and payload primitives (Identity, Kyber, Dilithium, Sphincs, Fingerprint, Revocation, AES, Payloads)
- `cli/` — command-line interface
- `gui/` — web frontend + local backend server
- `server/` — public key server
- `mobile/` — React Native mobile app
- `email/chrome-extension/` — browser extension for webmail
- `desktop/` — [[component-desktop|Tauri shell for desktop packaging]]

## Versioning Notes

EBP documentation follows [[semantic-versioning]] conventions when describing release compatibility expectations, and keeps protocol payload schema versions documented separately in [[message-payload-formats]].

## Upcoming Features

- FN-DSA (Falcon) support
- ENS integration for fingerprint lookup
- Identity hierarchy (master → cold → hot key chains); see [[analysis-bip-patterns-for-ebp]] for HD-wallet (BIP32/39/43/44) patterns as one implementation approach
- Advanced email features (search, drafts, rich rendering, scheduled send)
- Hashed/opaque detail endorsement
- Identity expiry dates

## Sources

- `ReadMe.md`
- `core/Identity.ts`
- `core/Fingerprint.ts`
- `core/Revocation.ts`
- `core/version.ts`
- `wiki/raw/rfc8391.txt` → [[source-rfc-8391]]
- `wiki/raw/NIST.SP.800-208.pdf` → [[source-sp-800-208]]
- `wiki/raw/semver.md` → [[source-semver-2-0-0]]
- `wiki/raw/NIST.FIPS.197-upd1.pdf` → [[source-fips-197]]
- `wiki/raw/nistspecialpublication800-38d.pdf` → [[source-sp-800-38d]]
- `wiki/raw/draft-ietf-openpgp-pqc-17.txt` → [[source-draft-ietf-openpgp-pqc-17]]
- `wiki/raw/rfc5280.txt` → [[source-rfc-5280]]
- `wiki/raw/rfc3986.txt` → [[source-rfc-3986]]
- `wiki/raw/rfc5321.txt` → [[source-rfc-5321]]
- `wiki/raw/rfc9051.txt` → [[source-rfc-9051]]
- `wiki/raw/hashcash.pdf` → [[source-hashcash-adam-back-2002]]
- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]]