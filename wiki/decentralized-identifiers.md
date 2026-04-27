---
title: "Decentralized Identifiers"
type: concept
status: active
last_updated: 2026-04-27
source_count: 1
tags:
  - identity
  - did
  - decentralized-identity
  - uri
---

# Decentralized Identifiers

Decentralized Identifiers (DIDs) are URI-based identifiers that resolve to DID documents. [[source-did-1-1]] defines the common architecture and data model, while concrete DID methods define how a DID is created, resolved, updated, and deactivated.

## DID Model

A DID has the form `did:<method-name>:<method-specific-id>`. The method name selects a DID method, and the method-specific identifier is interpreted by that method. A DID URL can add path, query, and fragment components to refer to a verification method, service, or other resource associated with the DID.

A DID document can contain verification methods, verification relationships, controllers, equivalent identifiers, and services. The document is not the subject itself; it is resolution metadata controlled by the DID controller for enabling verifiable interactions with the DID subject.

## Comparison With EBP

EBP does not currently use DIDs. Its [[identity-model]] identifies a dual-key object by a bech32 Merkle-root fingerprint, with fixed roles for signing and encryption/KEM keys. The [[component-server]] stores and serves EBP identities, details, revocations, and hierarchy data, but it is not documented as a DID method or DID resolver.

DIDs are useful comparison material because they separate controller authority, verification methods, service endpoints, and resolver behavior. EBP makes a narrower choice: the fingerprint commits directly to the two public keys, while extra details and revocations are signed EBP records tied back to that fingerprint.

## Security and Privacy Notes

DID v1.1 emphasizes that proof of control is not the same as proof that a key has never been compromised, or proof that a persistent identifier still refers to the same subject in every context. It also warns that human-friendly identifiers and service endpoints can create correlation and privacy risks.

Those cautions map cleanly to EBP: fingerprints and signatures establish cryptographic control over key material, while contact verification, revocation state, server discovery, and user judgment still matter for trust.

## Related Pages

- [[identity-model]]
- [[component-server]]
- [[revocation-system]]
- [[uri-syntax]]
- [[overview]]

## Sources

- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]]
