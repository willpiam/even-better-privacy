---
title: "RFC 5321: Simple Mail Transfer Protocol"
type: source-summary
status: active
last_updated: 2026-04-27
source_count: 1
tags:
  - source
  - rfc
  - smtp
  - email
  - transport
---

# RFC 5321: Simple Mail Transfer Protocol

**Raw file:** `wiki/raw/rfc5321.txt`
**Published:** October 2008
**Status:** Standards Track

## Summary

RFC 5321 specifies SMTP, the basic protocol for Internet electronic mail transport. It covers the SMTP model, commands and replies, mail transactions, relay behavior, MX-based routing, delivery failure handling, and SMTP security considerations.

For EBP, the most important point is layering: SMTP transports a message but does not provide the end-to-end authenticity or confidentiality that EBP cares about. RFC 5321 explicitly says real mail security depends on end-to-end methods involving the message body, such as digitally signed or encrypted message bodies.

## Key Topics

- SMTP session model, including `EHLO`, `MAIL`, `RCPT`, `DATA`, replies, and command sequencing.
- SMTP extensions advertised through `EHLO`.
- The distinction between the SMTP envelope (`MAIL FROM`, `RCPT TO`) and the RFC 5322 message header/body.
- MX record lookup and retry behavior for mail routing.
- Delivery failure handling, trace fields, address verification commands, and operational abuse considerations.
- Security limitations of SMTP transport authentication compared with end-to-end message security.

## EBP Relevance

RFC 5321 anchors the SMTP side of [[email-transport]] and [[component-gui]]:

- The GUI's native email send path uses SMTP as a carriage mechanism; EBP encryption and signatures live in [[message-payload-formats]], not in SMTP itself.
- SMTP envelope addresses and message headers are separate from EBP sender fingerprints and cryptographic verification results.
- SMTP trace fields and envelope handling may expose operational metadata even when the EBP message body is encrypted.
- SMTP local-parts are formally case-sensitive, even though many providers normalize them in practice; EBP identity details should avoid assuming provider-specific email canonicalization rules without an explicit policy.

## Caveats

RFC 5321 does not define the full syntax of message headers or MIME bodies; it points to RFC 5322 and MIME specifications for message content structure. It also predates some modern submission and authentication practices, so it should be cited for SMTP transport boundaries rather than as a complete description of provider-specific mail submission.

## Related Pages

- [[email-transport]]
- [[component-gui]]
- [[component-email-extension]]
- [[message-payload-formats]]
- [[overview]]

## Sources

- `wiki/raw/rfc5321.txt`
