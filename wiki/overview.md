---
title: "Even Better Privacy (EBP) Overview"
type: overview
status: active
last_updated: 2026-04-12
source_count: 7
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
| ML-DSA (Dilithium) | FIPS 204 | Signing / Auth | ML-DSA-87 |
| SLH-DSA (SPHINCS+) | FIPS 205 | Signing / Auth | SLH-DSA-SHA2-256s |
| FN-DSA (Falcon) | (planned) | Signing / Auth | TBD |

All currently used parameter sets target NIST Security Category 5. See [[source-fips-203]], [[source-fips-204]], [[source-fips-205]] for standard summaries. For background on the stateful hash-based predecessors (XMSS, LMS) that motivated SLH-DSA's stateless design, see [[source-rfc-8391]] and [[source-sp-800-208]].

## Main System Components

- [[component-cli]]: command-line interface for identity lifecycle and message/file operations.
- [[component-gui]]: browser-based GUI with local backend, plus native email integration.
- [[component-server]]: key/discovery server and API for publish/fetch/revocation data.
- [[component-email-extension]]: Chrome extension for webmail encryption/signing workflows.
- [[component-mobile]]: React Native mobile app (under development, targeting GUI feature parity).

## How It Works

1. Generate an identity (creates a signing key + encryption key pair).
2. Share your public identity with others (fingerprint + public keys).
3. Import contacts' public identities.
4. Sign messages — recipients verify using your public signing key.
5. Encrypt messages — recipients decrypt using their private encryption key.

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
- `desktop/` — Tauri shell for desktop packaging

## Upcoming Features

- FN-DSA (Falcon) support
- ENS integration for fingerprint lookup
- Identity hierarchy (master → cold → hot key chains)
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