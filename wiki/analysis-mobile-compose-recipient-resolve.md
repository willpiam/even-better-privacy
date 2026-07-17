---
title: "Mobile Compose Recipient Resolve"
type: analysis
status: active
last_updated: 2026-07-17
source_count: 4
tags:
  - analysis
  - mobile
  - mail
  - contacts
  - opaque-details
---

# Mobile Compose Recipient Resolve

On [[component-mobile]] compose, the To address is resolved against local
contacts before send so encryption is either bound to an EBP identity or
explicitly declined.

## Behavior

1. On To-field blur (address contains `@`), call `findContactsByEmail`.
2. Match scope ([[identity-model]]):
   - Published `email` detail (case-insensitive)
   - `opaque::email` via `resolvedOpaqueDetails` or `sha256Hex(trimmedTyped)`
   - **Not** local-only `localEmail` notes
3. Outcomes:
   - **Unique match** → select that contact; encrypt on send (`sendEbpMail`)
   - **Zero or many** → `RecipientResolveModal`: searchable contact pick, or
     “not intended to be encrypted”
4. Unencrypted intent shows a red error banner and sends via
   `sendPlainMail` (`buildSimpleMimeMessage`).
5. Send is blocked while encryption intent is still `pending`.

Opaque hash matches may call `resolveOpaqueDetail` to persist cleartext for
later UI (same path as Contact Detail).

## Why this differs from GUI

GUI compose (`findContactForComposeRecipient`) matches cleartext email /
`localEmail` and uses a global plain vs EBP mode. Mobile matches opaque email
hashes and prompts per recipient when unresolved.

## Code

- `mobile/src/services/contacts.ts` — `findContactsByEmail`
- `mobile/src/services/mail/ebpMail.ts` — `sendPlainMail`
- `mobile/src/components/RecipientResolveModal.tsx`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/MAIL.md` — compose recipient resolution note

## Related

- [[component-mobile]]
- [[identity-model]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-imap-smtp-inbox-empty]]

## Sources

- `mobile/src/services/contacts.ts`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/MAIL.md`
- [[identity-model]]
