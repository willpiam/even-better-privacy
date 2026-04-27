---
title: "Source Summary: NIST SP 800-57 Part 3 Rev. 1"
type: source-summary
status: active
last_updated: 2026-04-25
source_count: 1
tags:
  - source
  - nist
  - key-management
  - applications
  - pkix
---

# NIST SP 800-57 Part 3 Rev. 1 — Application-Specific Key Management

**Raw file:** `wiki/raw/NIST.SP.800-57Pt3r1.pdf`
**Published:** January 2015

## Summary

NIST SP 800-57 Part 3 Revision 1 gives application-specific key-management guidance for systems such as PKI, IPsec, TLS, S/MIME, Kerberos, OTAR, DNSSEC, EFS, and SSH.

Because this revision is from 2015, concrete cipher-suite and protocol recommendations may be stale. The source is most useful for structural questions such as key roles, negotiation, revocation, procurement, and administration.

## Key Points

- Mandatory-to-implement protocol requirements are not the same thing as NIST security recommendations.
- Application guidance repeatedly considers single-use versus multi-use keys, negotiation, transition, revocation, and key recovery.
- PKI guidance is relevant background for [[x509-pki]] but does not define EBP's identity model.
- TLS, S/MIME, and SSH guidance should be checked against modern protocol standards before being cited as current allow-list guidance.

## EBP Relevance

Part 3 provides context for [[key-management]], [[component-email-extension]], and [[component-server]] when comparing EBP to conventional application protocols. It should be cited with an explicit staleness caution for modern TLS, S/MIME, and SSH choices.

## Related Pages

- [[key-management]]
- [[x509-pki]]
- [[component-email-extension]]
- [[source-sp-800-57-part-1-r5]]
- [[source-sp-800-57-part-2-r1]]

## Sources

- `wiki/raw/NIST.SP.800-57Pt3r1.pdf`
