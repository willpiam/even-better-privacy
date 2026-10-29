---
title: "Mobile Compose Recipient Resolve"
type: analysis
status: active
last_updated: 2026-10-28
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

1. On To-field blur (address contains `@`), call `resolveVerifiedRecipient`.
2. Local match scope ([[identity-model]]):
   - Published `email` detail (case-insensitive)
   - `opaque::email` via `resolvedOpaqueDetails` or `sha256Hex(trimmedTyped)`
   - **Not** local-only `localEmail` notes
   - One local match selects that contact and does not consult the server
   - Several local matches open the modal
3. With no local match, search `GET /api/v1/identities/search` and keep a hit
   only when exactly one unrevoked identity has a verified `email` detail
   equal to the address ([[analysis-pqpost-recipient-identity]]). Fetch and
   save that public identity, unless the fingerprint is already stored.
4. Otherwise `RecipientResolveModal`: searchable contact pick, or
   “not intended to be encrypted”.
5. Unencrypted intent shows a red error banner and sends via
   `sendPlainMail` (`buildSimpleMimeMessage`).
6. Send is blocked while encryption intent is still `pending`.
7. A reply that already selected an encrypt-to contact is not replaced.
   Changing the To address runs resolution again.

Opaque hash matches may call `resolveOpaqueDetail` to persist cleartext for
later UI (same path as Contact Detail).

## Why this differs from GUI

Both clients auto-fill from one exact verified server identity
([[analysis-pqpost-recipient-identity]]). GUI local matching also accepts
`localEmail` and uses one compose mode for the whole message. Mobile matches
opaque email hashes and prompts per recipient when the address stays
unresolved.

## Code

- `mobile/src/services/contacts.ts` — `resolveVerifiedRecipient`
- `core/VerifiedEmailMatch.ts` — exact verified-email match
- `mobile/src/services/mail/ebpMail.ts` — `sendPlainMail`
- `mobile/src/components/RecipientResolveModal.tsx`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/MAIL.md` — compose recipient resolution note

## Related

- [[component-mobile]]
- [[identity-model]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[analysis-pqpost-recipient-identity]]

## Sources

- `mobile/src/services/contacts.ts`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/MAIL.md`
- [[identity-model]]
