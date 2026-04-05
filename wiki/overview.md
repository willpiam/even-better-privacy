---
title: "Even Better Privacy (EBP) Overview"
type: overview
status: seed
last_updated: 2026-04-05
source_count: 1
tags:
  - ebp
  - overview
  - architecture
---

# Even Better Privacy (EBP)

EBP is a reference implementation of a post-quantum secure identity and messaging system. It is positioned as a successor pattern to PGP, with an identity model that always combines signing and encryption/KEM keys.

## Core Idea

Unlike legacy systems that often use one asymmetric scheme for multiple tasks, EBP models an identity as two key capabilities:

- authentication/signing key material (for message authenticity)
- encryption/KEM key material (for confidentiality)

See [[identity-model]] for details.

## Main System Components

- [[component-cli]]: command-line interface for identity lifecycle and message/file operations.
- [[component-gui]]: browser-based GUI with local backend.
- [[component-server]]: key/discovery server and API for publish/fetch/revocation data.
- [[component-email-extension]]: browser extension integrations for webmail encryption/signing workflows.

## Cryptographic Direction

Current and planned schemes are documented in:

- [[ml-kem]]
- [[slh-dsa]]
- [[ml-dsa]]

## Revocation and Trust Maintenance

EBP includes signed revocation certificates for both individual details and whole identities, with nonce handling to prevent replay issues. See [[revocation-system]].

## Project Shape

The repository is organized as a multi-surface implementation:

- `core/` for shared crypto and payload primitives
- `cli/`, `gui/`, `server/`, `mobile/` for product surfaces
- `email/chrome-extension/` for webmail integration

## Sources

- `ReadMe.md`
