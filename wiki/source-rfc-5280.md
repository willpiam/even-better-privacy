---
title: "Source Summary: RFC 5280 — PKIX Certificate and CRL Profile"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - rfc
  - x509
  - pkix
  - revocation
---

# RFC 5280 — Internet X.509 PKI Certificate and CRL Profile

**Raw file:** `wiki/raw/rfc5280.txt`
**Published:** May 2008
**Status:** Standards Track

## Summary

RFC 5280 profiles X.509 v3 public-key certificates and X.509 v2 certificate revocation lists for Internet PKI use. It defines certificate fields, standard extensions, Internet-specific extensions, certification path validation, and CRL validation.

The RFC is relevant to EBP mainly as a contrast point. EBP's identity model is not X.509-based and does not use CA-issued certificate paths or CRLs. Its revocations are signed EBP certificates tied to EBP fingerprints rather than PKIX CRLs tied to issuer/subject certificate chains.

## Key Topics

- X.509 v3 certificate structure, including subject, issuer, validity, public-key info, and extensions.
- Certificate extensions such as basic constraints, key usage, extended key usage, subject alternative name, authority information access, and name constraints.
- Certification path validation, including trust anchors, policy processing, name constraints, and per-certificate checks.
- X.509 v2 CRLs, CRL extensions, CRL-entry extensions, delta CRLs, distribution points, and CRL validation.
- Internationalized name handling for DNS names, email addresses, distinguished names, and IRIs.

## EBP Relevance

RFC 5280 is useful background for [[x509-pki]] and [[revocation-system]] because it documents the dominant certificate-chain and CRL design used by many Internet protocols. EBP deliberately follows a different model:

- EBP identities are self-contained dual-key objects identified by bech32 fingerprints, not CA-issued X.509 certificates.
- EBP trust decisions are based on fingerprint/key verification and server/contact state, not PKIX path validation.
- EBP revocation certificates are signed by the identity's own signing key, not issued by a CA as CRL entries.

## Related Pages

- [[x509-pki]]
- [[identity-model]]
- [[revocation-system]]
- [[component-server]]

## Sources

- `wiki/raw/rfc5280.txt`
