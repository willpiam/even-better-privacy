# Wiki Index

Last updated: 2026-04-10

## Overview

- [[overview]] - High-level synthesis of EBP goals, architecture, and usage model.

## Cryptographic Schemes

- [[ml-kem]] - ML-KEM-1024 (Kyber) usage: KEM + AES-256-GCM confidentiality workflow.
- [[slh-dsa]] - SLH-DSA-SHA2-256s (SPHINCS+) hash-based signing; compact keys, large signatures.
- [[ml-dsa]] - ML-DSA-87 (Dilithium) lattice-based signing; compact signatures, larger keys.
- [[fn-dsa]] - FN-DSA (Falcon) planned future signing scheme; not yet implemented.

## Core Concepts

- [[identity-model]] - Dual-key identity structure, merkle-tree fingerprints, bech32 encoding, details system.
- [[message-payload-formats]] - Wire formats for signed, encrypted, and encrypted+signed message payloads.
- [[revocation-system]] - Signed revocation certificates, nonce protection, emergency certs, server integration.

## Components

- [[component-cli]] - CLI for identity lifecycle, crypto operations, and server interaction.
- [[component-gui]] - Graphical interface with local backend, native email, and Tauri desktop packaging.
- [[component-server]] - Publish/discovery API with identity, detail, revocation, hierarchy, and OAuth endpoints.
- [[component-email-extension]] - Chrome extension for sign/encrypt in Gmail, Outlook, Proton Mail webmail.
- [[component-mobile]] - React Native mobile app (under development).
- [[component-website]] - Static public site with marketing landing page and browser-based signature verifier.

## Analyses

- [[analysis-sync-revoked-details-bug]] - Bug: Sync From Server did not strip revoked details before saving contacts.
- [[analysis-linux-build]] - Linux install and local AppImage build flow, including sidecar redirect architecture.

## Security Audits

- [[security-audit-2026-04/README|Security Audit — April 2026]] - Phased security audit covering crypto core, server, GUI, CLI, website, supply chain, storage, and dynamic testing.

## Source Summaries

- [[source-fips-203]] - NIST FIPS 203: ML-KEM standard (parameter sets, security levels, EBP usage).
- [[source-fips-204]] - NIST FIPS 204: ML-DSA standard (parameter sets, security levels, EBP usage).
- [[source-fips-205]] - NIST FIPS 205: SLH-DSA standard (parameter sets, hash-only security, EBP usage).
- [[source-rfc-8391]] - RFC 8391: XMSS stateful hash-based signature scheme (WOTS+, Merkle trees, parameter sets).
- [[source-sp-800-208]] - NIST SP 800-208: Federal recommendation for stateful HBS schemes (LMS, XMSS, conformance requirements).
