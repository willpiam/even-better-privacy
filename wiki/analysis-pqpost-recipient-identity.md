---
title: "pqpost.com Recipient Identity"
type: analysis
status: active
last_updated: 2026-10-28
source_count: 7
tags:
  - analysis
  - email
  - identity
  - pqpost
  - compose
---

# pqpost.com Recipient Identity

A `@pqpost.com` address created by EBP signup is bound to one published
identity. The domain alone does not mean every recipient address has a
resolvable identity, and compose does not look the binding up.

## What signup guarantees

`POST /api/v1/mail/signup` refuses to create `username@<MAIL_DOMAIN>` unless
the caller has already published an unrevoked identity and signed an `email`
detail for that exact address ([[analysis-ebp-managed-email-onboarding]]).
The server then:

- inserts a `mailboxes` row whose `identity_fingerprint` is that identity;
- writes the cleartext `email` detail and sets `verified_at` because the
  server issued the address.

That is a one-mailbox-per-fingerprint rule. Managed signup uses `email`, not
`opaque::email`. Production `MAIL_DOMAIN` is `pqpost.com`.

## Where the guarantee stops

These addresses can appear in a To field and still have no usable identity:

- **Never registered.** SMTP may accept or bounce mail to a local-part that
  has no `mailboxes` row. Signup is the only path that creates the binding.
- **Reserved and operator mailboxes.** `core/MailUsername.ts` blocks signup
  for names such as `postmaster`, `noreply`, `admin`, and `e2e` plus digits
  (the last group is test-only). Accounts created directly in Stalwart,
  including the key server's `noreply@pqpost.com` sender, have no fingerprint.
- **Identity revoked later.** Revocation does not remove the mailbox row.
  Public search omits identity revocations unless `includeRevoked=true`. A
  revoked identity is not an encryption target.
- **Email detail revoked or replaced later.** Detail revocation is not tied
  to the mailbox. A new `email` value can be posted only after the old detail
  is revoked. The Stalwart address can then differ from the published detail.
- **Someone else's published detail.** Uniqueness is `(fingerprint, path)`,
  not the address string. Another identity can publish the same address.
  Search can return more than one hit. The mailbox row is the unique owner
  record, and no public route reads it.

`GET /api/v1/identities/search` matches `name` and `email` with a substring
`LIKE`. It returns fingerprints and details, not encryption keys. A client
that wants to encrypt still has to `GET /api/v1/identity/<fingerprint>`.

## What compose does today

[[component-gui]] compose (`findContactForComposeRecipient`) and
[[component-mobile]] compose (`findContactsByEmail`) match only contacts
already stored on the device ([[analysis-mobile-compose-recipient-resolve]]).
A managed recipient who is not in the address book stays unresolved. Mobile
then asks the sender to pick a contact or to send unencrypted. GUI send
requires a resolved local contact.

## Server lookup

Compose asks the key server when the address is not already on the device.
The check is implemented for the GUI (`GET /api/v1/contacts/resolve-verified-email`
on the local backend) and for mobile (`resolveVerifiedRecipient`).

A hit is auto-filled only when all of these hold:

1. A contact already saved on the device wins. That copy is the pinned key.
   If the device already has that fingerprint, it is selected and not replaced.
2. The returned `email` detail equals the typed address. Search is a
   substring match and can also hit `name`.
3. That detail is verified and the identity is not revoked. Signup sets
   `verified_at` because the server issued the mailbox. Anyone else who
   publishes the same address stays unverified unless a verification message
   is accepted at that mailbox (`server/verify-email.ts`).
4. Exactly one identity passes those checks. The client pages through search
   results and refuses to choose when another page might still match.
5. The client then fetches `GET /api/v1/identity/<fingerprint>`, checks the
   full record again, and stores that public identity before encrypting.

A miss stays on the previous compose path. Mobile opens the resolve modal.
The GUI leaves the contact unresolved, and says so when more than one
verified identity publishes the address. A reply that already selected a
contact is left alone.

The first fetch still trusts the key server to return the real key for that
fingerprint. That is the same trust as importing a contact from the server.
The server also learns that this device looked the address up.

The `mailboxes` row remains the unique owner record. Exact verified-email
matching is the check the public API supports today.

## Related

- [[analysis-ebp-managed-email-onboarding]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-pqpost-readiness]]
- [[identity-model]]
- [[component-server]]

## Sources

- `server/handlers/mail-signup.ts`
- `server/handlers/discovery.ts`
- `server/handlers/revocation.ts`
- `server/verify-email.ts`
- `core/MailUsername.ts`
- `core/VerifiedEmailMatch.ts`
- `gui/js/mail.js`
- `gui/local-backend/resolve-verified-email.ts`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/src/services/contacts.ts`
