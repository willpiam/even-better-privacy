---
title: "X.509 and PKIX Context"
type: concept
status: active
last_updated: 2026-04-25
source_count: 2
tags:
  - x509
  - pkix
  - certificates
  - revocation
---

# X.509 and PKIX Context

X.509 and PKIX are the dominant certificate-chain model for many Internet protocols. RFC 5280, summarized in [[source-rfc-5280]], profiles X.509 certificates, CRLs, extensions, and path validation for Internet PKI.

## Contrast With EBP

EBP does not use X.509 certificates, CA-issued paths, or PKIX CRLs. Its [[identity-model]] represents an identity as a signing key plus KEM key, and its fingerprint is a bech32-encoded Merkle root over those public keys.

Revocation also differs. PKIX revocation is commonly represented through CRLs and related extensions, while EBP uses signed revocation certificates produced by the identity's own signing key. See [[revocation-system]].

## Where It Still Matters

X.509 context is useful when comparing EBP to TLS, S/MIME, enterprise PKI, or future public anchoring ideas. NIST SP 800-57 Part 3, summarized in [[source-sp-800-57-part-3-r1]], also discusses PKI as one of several application-specific key-management domains, though its 2015 protocol guidance should be checked against current standards before being treated as a modern allow-list.

## Related Pages

- [[source-rfc-5280]]
- [[source-sp-800-57-part-3-r1]]
- [[identity-model]]
- [[revocation-system]]
- [[component-server]]

## Sources

- `wiki/raw/rfc5280.txt` → [[source-rfc-5280]]
- `wiki/raw/NIST.SP.800-57Pt3r1.pdf` → [[source-sp-800-57-part-3-r1]]
