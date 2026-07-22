---
title: "Mobile Mail Reply"
type: analysis
status: active
last_updated: 2026-07-21
source_count: 6
tags:
  - analysis
  - mobile
  - email
  - reply
  - compose
---

# Mobile Mail Reply

## Summary

[[component-mobile]] message view has a **Reply** action that opens Compose
prefilled for a proper reply draft. For EBP-signed/encrypted originals, the
reply encrypts to the **signer** identity and is signed by the responder.

## Behavior

| Original | Reply available | Encrypt target | Sign |
|----------|-----------------|----------------|------|
| Plain | After load | Existing To-blur resolve ([[analysis-mobile-compose-recipient-resolve]]) | N/A (or encrypt if contact resolved) |
| EBP locked | No — “Decrypt to reply securely” | — | — |
| EBP decrypted | Yes | Signer contact (`contactName` / fingerprint / server import) | `sign: true` via `sendEbpMail` |

Prefill:

- **To:** address from message From (or authenticity `messageFrom`)
- **Subject:** `Re:` prefix via `formatReplySubject`
- **Body:** quoted original (`formatQuotedBody`)
- **Headers:** `In-Reply-To` / `References` from original `Message-ID` when present

## Crypto binding

Do not encrypt to SMTP From alone when a signer fingerprint exists. Resolve
order in `resolveReplyRecipientContact`:

1. Known contact name from authenticity
2. Local contact by `signerFingerprint`
3. `fetchContactFromServer` + import
4. Else leave compose pending so To resolve / modal still runs

Wire format remains [[message-payload-formats]] `ebp-encrypted-signed-message`.

## Code

- `mobile/src/services/mail/mailReply.ts` — subject, quote, Message-ID, contact resolve
- `mobile/src/screens/mail/MailMessageScreen.tsx` — Reply CTA
- `mobile/src/screens/mail/MailComposeScreen.tsx` — route-param prefill
- `mobile/src/services/mail/mime.ts` / `ebpMail.ts` — threading headers on send
- `mobile/MAIL.md` — Reply section

## Related

- [[component-mobile]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[message-payload-formats]]
- [[email-transport]]

## Sources

- `mobile/src/services/mail/mailReply.ts`
- `mobile/src/screens/mail/MailMessageScreen.tsx`
- `mobile/src/screens/mail/MailComposeScreen.tsx`
- `mobile/src/services/mail/mime.ts`
- `mobile/MAIL.md`
- [[message-payload-formats]]
