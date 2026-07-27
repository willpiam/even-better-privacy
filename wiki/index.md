---
title: "Wiki Index"
type: overview
status: active
last_updated: 2026-07-27
source_count: 0
tags:
  - wiki
  - index
---

# Wiki Index

Last updated: 2026-07-27 (mobile certificates UX)

## Wiki Operations

- [[index.md|Wiki Index]] - Master catalog grouped by category.
- [[log|Wiki Log]] - Append-only chronological operations log.

## Overview

- [[overview]] - High-level synthesis of EBP goals, architecture, and usage
  model.

## Cryptographic Schemes

- [[ml-kem]] - ML-KEM-1024 (Kyber) usage: KEM + AES-256-GCM confidentiality
  workflow.
- [[hqc]] - NIST-selected backup KEM (code-based); not implemented in EBP; draft
  standard ~2026, final ~2027.
- [[slh-dsa]] - SLH-DSA-SHA2-256s (SPHINCS+) hash-based signing; compact keys,
  large signatures.
- [[ml-dsa]] - ML-DSA-87 (Dilithium) lattice-based signing; compact signatures,
  larger keys.
- [[fn-dsa]] - FN-DSA (Falcon) planned future signing scheme; not yet
  implemented.

## Core Concepts

- [[identity-model]] - Dual-key identity structure, merkle-tree fingerprints,
  bech32 encoding, details system.
- [[message-payload-formats]] - Wire formats for signed, encrypted, and
  encrypted+signed message payloads.
- [[revocation-system]] - Signed revocation certificates, nonce protection,
  emergency certs, server integration.
- [[semantic-versioning]] - SemVer compatibility rules for release
  documentation, including pre-release/build metadata handling.
- [[aes-gcm]] - AES-256-GCM usage in EBP, including nonce/IV and associated-data
  context.
- [[cryptographic-algorithm-transitions]] - NIST transition vocabulary for
  algorithm/key-size lifetimes and legacy use.
- [[cryptographic-module-validation]] - Distinguishes FIPS-standardized
  algorithms from FIPS 140-3 validated modules.
- [[decentralized-identifiers]] - W3C DID v1.1 identity architecture compared
  with EBP fingerprinted identities.
- [[key-management]] - NIST SP 800-57 key lifecycle concepts mapped to EBP
  identity and revocation surfaces; includes non-EBP BIP32/39/43/44 comparison
  notes ([[source-bip-hd-wallet-standards]]).
- [[password-policy]] - Identity encryption password rules (12+ chars, 3-of-4
  classes, blocklist), CLI/GUI enforcement, and GUI opt-out setting.
- [[ebp-hd]] - Opt-in deterministic hierarchical identity layer: BIP39-English
  EBP mnemonic, HD paths, PQ leaf derivation, CLI/GUI onboarding, and discovery.
- [[integrity-renewal]] - Long-term renewal of timestamp/signature evidence
  across hash-function and algorithm transitions.
- [[release-process]] - Reproducible release checklist, build lints, and
  checksum manifest process.
- [[openpgp-pqc]] - Adjacent OpenPGP post-quantum standards context and
  differences from EBP payloads.
- [[random-bit-generation]] - NIST SP 800-90 randomness vocabulary and EBP's
  platform-CSPRNG boundary.
- [[uri-syntax]] - RFC 3986 URI parsing, normalization, percent-encoding, and
  URL-secret handling context.
- [[email-transport]] - SMTP transport and IMAP mailbox-access boundaries for
  EBP email payloads.
- [[hashcash-cost-functions]] - Hashcash and CPU cost-functions (Back 2002):
  proof-of-work email/DoS context; **not** part of EBP’s PQ payload model.
- [[x509-pki]] - X.509/PKIX certificate and CRL context contrasted with EBP
  identities and revocations.

## Components

- [[component-cli]] - CLI for identity lifecycle, crypto operations, and server
  interaction.
- [[component-gui]] - Graphical interface with local backend, native email, and
  Tauri desktop packaging.
- [[component-desktop]] - Tauri desktop shell and sidecar packaging for the GUI.
- [[component-server]] - Publish/discovery API with identity, detail,
  revocation, hierarchy, and OAuth endpoints.
- [[component-email-extension]] - Chrome extension for sign/encrypt in Gmail,
  Outlook, Proton Mail webmail.
- [[component-mobile]] - React Native mobile app (under development).
- [[component-website]] - Static public site with marketing landing page and
  browser-based signature verifier.

## Analyses

- [[analysis-email-backed-chat]] - Seed brainstorm: chat-like UI over SMTP/IMAP
  with `<ebp-fingerprint>@domain` addressing (personal or product domain).
- [[analysis-mobile-certificates-ux]] - Certificates screen aligned to password
  popup + ContactPicker hierarchy propose (GUI parity).
- [[analysis-key-encoding-rationale]] - Clarifies Base64 vs hex key/material
  encoding origins and the migration work needed to unify key encodings.
- [[analysis-ebp-hd-bip-compliance]] - Reviews whether EBP-HD can claim
  BIP32/39/43/44 compliance; recommends BIP39-English mnemonic-format
  compatibility plus BIP-inspired EBP-HD language.
- [[analysis-bip-patterns-for-ebp]] - Design analysis that led to [[ebp-hd]],
  mapping BIP32/39/43/44 structural patterns to PQ dual-key identities.
- [[analysis-shared-key-concept]] - Design note for introducing short-lived
  pairwise AES shared keys, bech32 shared-key fingerprints, signed certificates,
  expiry, and safe rollout phases.
- [[analysis-weakest-defined-architecture-concepts]] - Ranks the least-defined
  architecture concepts by page maturity, source depth, and implementation
  specificity; highlights FN-DSA, mobile parity, and roadmap-only concepts as
  the primary definition gaps.
- [[analysis-mail-message-load-hang]] - Bug analysis: selected email messages
  can appear to hang because full MIME fetch/parse work is unbounded and stale
  requests are not cancelled.
- [[analysis-sync-revoked-details-bug]] - Bug: Sync From Server did not strip
  revoked details before saving contacts.
- [[analysis-linux-build]] - Linux install and local AppImage build flow,
  including sidecar redirect architecture.
- [[analysis-top-open-security-issues]] - Historical closure ledger for
  once-open April 2026 audit findings; needs review before use as current
  prioritisation.
- [[analysis-address-recent-audit-findings-by-group-skill]] - Documents the
  planning skill for grouping unresolved findings above `foo`, enforcing Plan
  Mode, and closing the loop by rerunning the findings plot workflow.
- [[analysis-application-complexity-debt]] - Code- and wiki-grounded review of
  where EBP is more complicated than it needs to be (excluding `mobile/` and
  `email/`), grouped by hotspot with suggested decompositions.
- [[analysis-noble-library-usage]] - Central inventory of where EBP uses
  `@noble/post-quantum`, `@noble/hashes`, and `@noble/ciphers` across core,
  website verifier, and audit-documented surfaces.
- [[analysis-reimplementation-building-blocks]] - Reimplementation checklist of
  required crypto primitives, runtime operations, encodings, and deterministic
  mappings needed for cross-language compatibility.
- [[analysis-gui-mobile-parity-deltas]] - GUI vs mobile capability matrix and
  Parity v1 checklist (interop drift + feature gaps).
- [[analysis-mobile-parity-roadmap]] - Phased mobile–GUI parity implementation
  roadmap (wallet, HD, mail, hardening).
- [[analysis-mobile-imap-smtp-inbox-empty]] - Mobile manual IMAP/SMTP: empty inbox
  / failed send / Test button hang (locked secrets, implicit-TLS-only client,
  unbounded `readLine`, credentials) and fix checklist.
- [[analysis-mobile-compose-recipient-resolve]] - Compose To-address lookup
  against `email` / `opaque::email`, resolve modal, and unencrypted send warning.
- [[analysis-mobile-mail-decrypt-invalid-json]] - Mobile decrypt shows
  `Invalid JSON payload` because MIME is not CTE-decoded before armor parse;
  password is unused for this error.
- [[analysis-mobile-encrypted-mail-reader-ux]] - Mobile encrypted mail reader
  (implemented): locked layout, authenticity badge, sender-summary drill-down;
  opaque endorsement supported via [[analysis-opaque-detail-endorsement]].
- [[analysis-mobile-mail-reply]] - Mobile Reply: prefill To/`Re:`/quote/
  threading headers; EBP replies encrypt to signer contact and sign as responder.
- [[analysis-mobile-contact-display-component]] - Shared mobile contact
  primary/secondary labels (alias → name → email → condensed fp) and call sites
  for ContactPicker / Contacts / resolve / browse.
- [[analysis-mobile-standalone-install]] - Why debug Metro installs die after
  disconnect; Android release via `build_mobile_android.sh`; iOS still open.
- [[analysis-opaque-detail-endorsement]] - Opaque/`opaque::email` endorsement
  implemented: hash-check verify-email request, GUI/mobile cleartext prompts,
  `detailsMeta` for opaque paths.

## Security Audits

- [[security-audit-2026-04/README|Security Audit — April 2026]] - Phased
  security audit covering crypto core, server, GUI, CLI, website, supply chain,
  storage, and dynamic testing. **Completed 2026-04-18** with 75 findings; see
  [[security-audit-2026-04/report|final report]] and
  [[security-audit-2026-04/findings|findings register]].
- [[security-audit-2026-04/threat-model|April 2026 Threat Model]] - Assets,
  adversaries, trust boundaries, and STRIDE analysis for the audit.
- [[security-audit-2026-04/phase-01-scaffolding|Phase 1 — Scaffolding & Threat
  Model]] - Audit setup, scope, naming conventions, and initial threat model
  links.
- [[security-audit-2026-04/phase-02-crypto-core|Phase 2 — Crypto Core]] - Manual
  review notes for `core/`.
- [[security-audit-2026-04/phase-03-server|Phase 3 — Server]] - Public API and
  server implementation review notes.
- [[security-audit-2026-04/phase-04-gui|Phase 4 — GUI]] - GUI local backend and
  frontend review notes.
- [[security-audit-2026-04/phase-05-cli-website-tauri|Phase 5 — CLI, Website,
  Tauri]] - CLI, website verifier, and desktop shell review notes.
- [[security-audit-2026-04/phase-06-supply-chain|Phase 6 — Supply Chain]] -
  Dependency, build, Docker, and release-chain review notes.
- [[security-audit-2026-04/phase-07-storage|Phase 7 — Storage]] - Identity
  storage, permissions, password, and key-management review notes.
- [[security-audit-2026-04/phase-08-dynamic|Phase 8 — Dynamic Testing]] -
  Runtime testing and proof-of-concept notes.

## Source Summaries

- [[source-bip-hd-wallet-standards]] - Bitcoin BIPs 32/39/43/44: HD wallets,
  mnemonics, purpose namespaces, and multi-account paths; comparison-only for
  EBP (PQ identities, not secp256k1).
- [[source-did-1-1]] - W3C DID v1.1: URI-based decentralized identifiers, DID
  documents, methods, verification methods, and services.
- [[source-draft-ietf-openpgp-pqc-17]] - IETF OpenPGP PQC draft covering
  composite ML-KEM/ML-DSA and SLH-DSA algorithm profiles.
- [[source-google-cloud-unverified-apps]] - Google Cloud Help: OAuth
  “unverified” apps, warnings, 100-user cap, and verification requirements for
  sensitive/restricted scopes.
- [[source-google-oauth2-web-server]] - Google Identity: OAuth 2.0
  authorization-code flow for web server apps (redirect URIs, offline refresh,
  revocation).
- [[source-google-cross-account-protection-risc]] - Google Cross-Account
  Protection (RISC): signed security-event JWTs for Google Sign-In account and
  token lifecycle changes.
- [[source-fips-140-3]] - NIST FIPS 140-3 cryptographic module security
  requirements and CMVP validation context.
- [[source-fips-197]] - NIST FIPS 197 Advanced Encryption Standard (AES) block
  cipher specification.
- [[source-fips-203]] - NIST FIPS 203: ML-KEM standard (parameter sets, security
  levels, EBP usage).
- [[source-nist-hqc-fifth-pq-encryption]] - NIST news (2025-03): HQC selected as
  backup general-encryption KEM; ML-KEM remains primary.
- [[source-fips-204]] - NIST FIPS 204: ML-DSA standard (parameter sets, security
  levels, EBP usage).
- [[source-fips-205]] - NIST FIPS 205: SLH-DSA standard (parameter sets,
  hash-only security, EBP usage).
- [[source-long-lived-digital-integrity-using-short-lived-hash-functions]] -
  Renewal strategy for preserving long-term timestamp and signature
  verifiability despite hash deprecation.
- [[source-hashcash-adam-back-2002]] - Back (2002): hashcash proof-of-work,
  cost-function taxonomy, interactive/hashcash-cookies, and contrast with client
  puzzles / time-lock cost-functions.
- [[source-rfc-3986]] - RFC 3986: generic URI syntax, percent-encoding,
  reference resolution, normalization, and URI security notes.
- [[source-rfc-4648]] - RFC 4648: Base16/32/64 encodings, padding, base64 vs
  base64url, and strict-vs-liberal decoding expectations for JSON byte fields.
- [[source-rfc-5321]] - RFC 5321: SMTP transport, envelope/header separation, MX
  routing, and end-to-end mail-security boundary.
- [[source-rfc-5280]] - RFC 5280: X.509 PKIX certificate and CRL profile, path
  validation, and revocation context.
- [[source-rfc-8391]] - RFC 8391: XMSS stateful hash-based signature scheme
  (WOTS+, Merkle trees, parameter sets).
- [[source-rfc-9051]] - RFC 9051: IMAP4rev2 mailbox access, message fetching,
  TLS expectations, and access-vs-submission boundary.
- [[source-sp-800-208]] - NIST SP 800-208: Federal recommendation for stateful
  HBS schemes (LMS, XMSS, conformance requirements).
- [[source-sp-800-131a-r2]] - NIST SP 800-131A Rev. 2: transition statuses for
  classical algorithms and key lengths.
- [[source-sp-800-38c]] - NIST SP 800-38C: CCM authenticated encryption mode for
  AES and other 128-bit block ciphers.
- [[source-sp-800-38d]] - NIST SP 800-38D: GCM/GMAC authenticated encryption
  mode, IV uniqueness, and associated data.
- [[source-sp-800-57-part-1-r5]] - NIST SP 800-57 Part 1 Rev. 5: general
  key-management lifecycle guidance.
- [[source-sp-800-57-part-2-r1]] - NIST SP 800-57 Part 2 Rev. 1: organizational
  key-management policy and CKMS guidance.
- [[source-sp-800-57-part-3-r1]] - NIST SP 800-57 Part 3 Rev. 1:
  application-specific key-management guidance.
- [[source-sp-800-90a-r1]] - NIST SP 800-90A Rev. 1: deterministic random bit
  generator mechanisms.
- [[source-sp-800-90b]] - NIST SP 800-90B: entropy-source validation and
  health-test guidance.
- [[source-sp-800-90c]] - NIST SP 800-90C: random bit generator constructions
  combining entropy sources and DRBGs.
- [[source-semver-2-0-0]] - Semantic Versioning 2.0.0 specification
  (MAJOR.MINOR.PATCH rules, precedence, metadata semantics).
