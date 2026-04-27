---
title: "W3C DID v1.1"
type: source-summary
status: active
last_updated: 2026-04-27
source_count: 1
tags:
  - source
  - w3c
  - did
  - decentralized-identity
  - uri
  - identity
---

# W3C Decentralized Identifiers (DIDs) v1.1

**Raw file:** `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf`
**Published:** W3C Candidate Recommendation Snapshot, 05 March 2026
**Status:** Candidate Recommendation

## Summary

Decentralized Identifiers (DIDs) v1.1 defines a URI-based identifier architecture for verifiable, decentralized digital identity. A DID identifies a DID subject and resolves, through a DID method, to a DID document that can contain verification methods, verification relationships, controllers, and services.

The source is relevant to EBP as adjacent identity-system context. EBP does not currently define a DID method or publish DID documents; it uses its own dual-key identity object and bech32 fingerprint. DID v1.1 is useful vocabulary for comparing controller-controlled identifiers, verification methods, service endpoints, resolution, and privacy tradeoffs.

## Key Topics

- DID syntax: `did:<method-name>:<method-specific-id>`, building on RFC 3986 URI syntax.
- DID URL syntax, including path, query, and fragment components for referring to verification methods, services, or other resources.
- DID documents as maps containing core properties such as `id`, `controller`, `alsoKnownAs`, `verificationMethod`, verification relationships, and `service`.
- DID methods as separate specifications that define creation, resolution, update, and deactivation over a verifiable data registry.
- Security requirements for DID methods, including attack analysis, update authentication, endpoint authentication, uniqueness policy, and cryptographic-protection boundaries.
- Privacy considerations around correlation, human-friendly identifiers, group privacy, encrypted data in public DID documents, and persistence.

## EBP Relevance

[[decentralized-identifiers]] compares DID architecture with EBP's [[identity-model]]:

- Both systems use cryptographic public material to support verifiable interactions.
- DID verification methods and relationships are more general and method-extensible, while EBP has fixed signing and encryption/KEM key roles.
- DID services can publish service endpoints; EBP details and the [[component-server]] publish/discovery API are not DID service endpoints.
- DID persistence does not by itself prove subject continuity or uncompromised control, which aligns with EBP's need for revocation and out-of-band trust checks.

## Caveats

The source is a Candidate Recommendation Snapshot, not a final W3C Recommendation. It also does not specify a concrete DID method, registry, blockchain, resolver implementation, or cryptographic suite for EBP.

## Related Pages

- [[decentralized-identifiers]]
- [[identity-model]]
- [[component-server]]
- [[uri-syntax]]
- [[overview]]

## Sources

- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf`
