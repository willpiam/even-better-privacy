---
title: "Email Transport and Access"
type: concept
status: active
last_updated: 2026-05-11
source_count: 3
tags:
  - email
  - smtp
  - imap
  - transport
  - gui
---

# Email Transport and Access

EBP can ride over ordinary email systems while keeping its cryptographic semantics in EBP payloads. [[source-rfc-5321]] describes SMTP transport, and [[source-rfc-9051]] describes IMAP4rev2 mailbox access.

## SMTP Send Layer

SMTP transports mail between clients, submission servers, relays, and delivery systems. It uses an envelope (`MAIL FROM`, `RCPT TO`) that is separate from the RFC 5322 message header and body.

For EBP, SMTP is only the send/carriage layer. It does not authenticate the EBP sender fingerprint, verify an EBP signature, or encrypt the message body. RFC 5321 explicitly frames robust mail security as an end-to-end property of the message body rather than a property of SMTP transport.

A different historical anti-abuse idea is **hashcash**-style **CPU proof-of-work** stamps on mail (summarized in [[hashcash-cost-functions]] from [[source-hashcash-adam-back-2002]]). That model throttles senders by computational cost at the transport or header layer; EBP instead places post-quantum signatures and encryption in the message payload and does not rely on hashcash.

## IMAP Receive Layer

IMAP4rev2 lets a client access and manipulate messages stored on a mail server. It supports mailbox operations, flags, search, UIDs, and selective fetches of message text and MIME body parts.

For EBP, IMAP is the mailbox access layer. The GUI may fetch the RFC 5322/MIME message through IMAP, then extract and process the EBP armored JSON described in [[message-payload-formats]].

## EBP Security Boundary

SMTP and IMAP can use transport security and provider authentication, but those mechanisms are separate from EBP end-to-end security:

- SMTP and IMAP expose operational metadata such as message routing, account, mailbox, and timing information.
- IMAP transport needs TLS or another protection layer to avoid cleartext exposure and response-injection risks.
- EBP authenticity and confidentiality come from the signed and encrypted payloads, not from email transport headers or mailbox state.

## Related Pages

- [[component-gui]]
- [[component-email-extension]]
- [[component-mobile]]
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[message-payload-formats]]
- [[openpgp-pqc]]
- [[hashcash-cost-functions]]
- [[overview]]

## Sources

- `wiki/raw/rfc5321.txt` → [[source-rfc-5321]]
- `wiki/raw/rfc9051.txt` → [[source-rfc-9051]]
- `wiki/raw/hashcash.pdf` → [[source-hashcash-adam-back-2002]]
