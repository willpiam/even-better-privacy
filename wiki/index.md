# Wiki Index

Last updated: 2026-04-27

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
- [[semantic-versioning]] - SemVer compatibility rules for release documentation, including pre-release/build metadata handling.
- [[aes-gcm]] - AES-256-GCM usage in EBP, including nonce/IV and associated-data context.
- [[cryptographic-algorithm-transitions]] - NIST transition vocabulary for algorithm/key-size lifetimes and legacy use.
- [[cryptographic-module-validation]] - Distinguishes FIPS-standardized algorithms from FIPS 140-3 validated modules.
- [[decentralized-identifiers]] - W3C DID v1.1 identity architecture compared with EBP fingerprinted identities.
- [[key-management]] - NIST SP 800-57 key lifecycle concepts mapped to EBP identity and revocation surfaces.
- [[openpgp-pqc]] - Adjacent OpenPGP post-quantum standards context and differences from EBP payloads.
- [[random-bit-generation]] - NIST SP 800-90 randomness vocabulary and EBP's platform-CSPRNG boundary.
- [[uri-syntax]] - RFC 3986 URI parsing, normalization, percent-encoding, and URL-secret handling context.
- [[email-transport]] - SMTP transport and IMAP mailbox-access boundaries for EBP email payloads.
- [[x509-pki]] - X.509/PKIX certificate and CRL context contrasted with EBP identities and revocations.

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
- [[analysis-top-open-security-issues]] - Ranked top remaining open findings from the April 2026 security audit (post-2026-04-22 remediation pass).

## Security Audits

- [[security-audit-2026-04/README|Security Audit — April 2026]] - Phased security audit covering crypto core, server, GUI, CLI, website, supply chain, storage, and dynamic testing. **Completed 2026-04-18** with 75 findings; see [[security-audit-2026-04/report|final report]] and [[security-audit-2026-04/findings|findings register]].

## Source Summaries

- [[source-did-1-1]] - W3C DID v1.1: URI-based decentralized identifiers, DID documents, methods, verification methods, and services.
- [[source-draft-ietf-openpgp-pqc-17]] - IETF OpenPGP PQC draft covering composite ML-KEM/ML-DSA and SLH-DSA algorithm profiles.
- [[source-fips-140-3]] - NIST FIPS 140-3 cryptographic module security requirements and CMVP validation context.
- [[source-fips-197]] - NIST FIPS 197 Advanced Encryption Standard (AES) block cipher specification.
- [[source-fips-203]] - NIST FIPS 203: ML-KEM standard (parameter sets, security levels, EBP usage).
- [[source-fips-204]] - NIST FIPS 204: ML-DSA standard (parameter sets, security levels, EBP usage).
- [[source-fips-205]] - NIST FIPS 205: SLH-DSA standard (parameter sets, hash-only security, EBP usage).
- [[source-rfc-3986]] - RFC 3986: generic URI syntax, percent-encoding, reference resolution, normalization, and URI security notes.
- [[source-rfc-5321]] - RFC 5321: SMTP transport, envelope/header separation, MX routing, and end-to-end mail-security boundary.
- [[source-rfc-5280]] - RFC 5280: X.509 PKIX certificate and CRL profile, path validation, and revocation context.
- [[source-rfc-8391]] - RFC 8391: XMSS stateful hash-based signature scheme (WOTS+, Merkle trees, parameter sets).
- [[source-rfc-9051]] - RFC 9051: IMAP4rev2 mailbox access, message fetching, TLS expectations, and access-vs-submission boundary.
- [[source-sp-800-208]] - NIST SP 800-208: Federal recommendation for stateful HBS schemes (LMS, XMSS, conformance requirements).
- [[source-sp-800-131a-r2]] - NIST SP 800-131A Rev. 2: transition statuses for classical algorithms and key lengths.
- [[source-sp-800-38c]] - NIST SP 800-38C: CCM authenticated encryption mode for AES and other 128-bit block ciphers.
- [[source-sp-800-38d]] - NIST SP 800-38D: GCM/GMAC authenticated encryption mode, IV uniqueness, and associated data.
- [[source-sp-800-57-part-1-r5]] - NIST SP 800-57 Part 1 Rev. 5: general key-management lifecycle guidance.
- [[source-sp-800-57-part-2-r1]] - NIST SP 800-57 Part 2 Rev. 1: organizational key-management policy and CKMS guidance.
- [[source-sp-800-57-part-3-r1]] - NIST SP 800-57 Part 3 Rev. 1: application-specific key-management guidance.
- [[source-sp-800-90a-r1]] - NIST SP 800-90A Rev. 1: deterministic random bit generator mechanisms.
- [[source-sp-800-90b]] - NIST SP 800-90B: entropy-source validation and health-test guidance.
- [[source-sp-800-90c]] - NIST SP 800-90C: random bit generator constructions combining entropy sources and DRBGs.
- [[source-semver-2-0-0]] - Semantic Versioning 2.0.0 specification (MAJOR.MINOR.PATCH rules, precedence, metadata semantics).
