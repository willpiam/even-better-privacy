---
title: "RFC 9051: IMAP4rev2"
type: source-summary
status: active
last_updated: 2026-04-27
source_count: 1
tags:
  - source
  - rfc
  - imap
  - imap4rev2
  - email
  - transport
  - tls
---

# RFC 9051: IMAP4rev2

**Raw file:** `wiki/raw/rfc9051.txt`
**Published:** August 2021
**Status:** Standards Track

## Summary

RFC 9051 specifies Internet Message Access Protocol Version 4rev2 (IMAP4rev2). IMAP lets a client access and manipulate mail messages on a server, including mailbox management, message flags, searching, selective fetching, and offline resynchronization. It obsoletes RFC 3501.

The RFC is relevant to EBP's GUI because the native email interface reads mailbox content through IMAP while EBP payload confidentiality and authenticity remain separate application-layer properties.

## Key Topics

- IMAP4rev2 client/server states, commands, responses, mailbox access, message sequence numbers, and UIDs.
- Fetching full messages or selected parts through `FETCH`, including `BODY`, `BODYSTRUCTURE`, and related message attributes.
- Parsing of message data according to RFC 5322, MIME, and related email standards.
- Separation of IMAP mailbox access from message submission, which is handled by a submission protocol such as RFC 6409.
- Security guidance for TLS, implicit TLS, STARTTLS, hostname verification, unsolicited cleartext responses, and password-bearing login mechanisms.

## EBP Relevance

RFC 9051 anchors the IMAP side of [[email-transport]] and [[component-gui]]:

- The GUI's native email receive path can fetch mailbox messages through IMAP; [[message-payload-formats]] still defines the EBP armored JSON extracted from the fetched message body.
- IMAP is an access protocol, not a sending protocol and not an end-to-end content security layer.
- IMAP4rev2 expects TLS 1.2 or newer, recommends TLS 1.3, requires server hostname validation, and discusses both implicit TLS and STARTTLS.
- Cleartext IMAP can expose mail data and permit response-injection confusion before protection is negotiated.

## Caveats

RFC 9051 does not imply that the current EBP implementation uses every IMAP4rev2-specific facility. Provider behavior, OAuth authentication, Proton Mail Bridge behavior, and the concrete `gui/local-backend/mail-imap.ts` implementation should be checked separately when making implementation claims.

## Related Pages

- [[email-transport]]
- [[component-gui]]
- [[message-payload-formats]]
- [[overview]]

## Sources

- `wiki/raw/rfc9051.txt`
