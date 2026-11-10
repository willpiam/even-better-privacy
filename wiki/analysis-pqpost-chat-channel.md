---
title: "pqpost Chat Channel"
type: analysis
status: active
last_updated: 2026-10-30
source_count: 0
tags:
  - chat
  - email
  - pqpost
  - ux
  - transport
---

# pqpost Chat Channel

A text-message UI on desktop and mobile, for `username@pqpost.com` peers, carried by the existing SMTP/IMAP path. The message stays an ordinary EBP email. A channel marker tells EBP clients to file it in Chat instead of Mail.

This supersedes the addressing sketch in [[analysis-email-backed-chat]] for product work. That page used a fingerprint as the SMTP local-part. Managed mailboxes already bind one `username@<MAIL_DOMAIN>` to one identity ([[analysis-ebp-managed-email-onboarding]], [[analysis-pqpost-recipient-identity]]). Chat should use that address.

## Implementation

Desktop and mobile both ship this split.

- Shared rules live in `common/ChatChannel.ts` (header, subject, peer grouping, message-id helpers).
- Desktop: sidebar Chat page (`gui/js/chat.js`). `GET /api/v1/mail/messages` searches with `NOT HEADER X-EBP-Channel chat`. `GET /api/v1/mail/chat` groups INBOX and Sent. `POST /api/v1/mail/send-ebp` accepts `channel: "chat"`. `POST /api/v1/mail/message/seen` sets `\Seen`.
- Mobile: Chat tab (`mobile/src/screens/chat/`). Inbox search uses the same `NOT HEADER` exclusion. Send goes through `sendEbpMail({ channel: "chat" })`.
- While a chat screen is open, the client refreshes about every 20 seconds. IMAP IDLE is not used.
- A row that fails decrypt or verify stays in the thread as an error with Open in Mail. The mail list does not decrypt in order to classify.

## Recommendation

Keep one protocol. Add one presentation bit.

| Layer | v1 behavior |
| --- | --- |
| Address | Peer is `local-part@` the configured mail domain (`pqpost.com` in production). |
| Crypto | Same encrypt-and-sign payload as mail ([[message-payload-formats]]). Fresh ML-KEM encapsulation per message. |
| Transport | Same SMTP submit and IMAP mailbox ([[email-transport]]). |
| Split | Cleartext header `X-EBP-Channel: chat`. Absent header means Mail. |
| UI | Chat groups by peer address and shows bubbles in time order. Mail hides chat-channel messages by default. |

Both GUI and mobile must honor the same header, so a thread opened on one device matches the other. The mailbox is already shared.

## Why a header, not a new payload

The signature on an encrypted message covers the plaintext via `ebp::message::v1::` ([[message-payload-formats]], `core/MessageHash.ts`). It does not cover RFC 5322 headers. Putting `channel` inside a new signed envelope would authenticate the sender's choice of screen, and it would force a payload-version bump before any chat UI exists.

For v1 the header is enough:

- Clients sort without decrypting every row. Full MIME fetch is already a known cost ([[analysis-mail-message-load-hang]]).
- A client that does not understand the header still shows the message as mail. That is the interop property worth keeping.
- On pqpost-to-pqpost, both hops are the managed Stalwart host, so the header is not crossing an unrelated relay.

The header is not signed. A sender can choose Chat or Mail; that is the feature. An on-path rewriter could flip the header. Treat that as a later binding problem (add `channel` to a new message-hash envelope) once the UI exists. Until then, Chat should list a message only when the header is present **and** the payload decrypts and verifies. An unsigned message with the header stays in Mail.

## Wire shape

- `Subject` is the fixed token `Chat`. The server and any non-EBP preview then do not see the user's text. Confidentiality still comes from the armored body, as with mail today.
- Body is the usual EBP armor in `text/plain`. The bubble shows the decrypted plaintext only.
- No quoted history in the body. Set `In-Reply-To` and `References` to the previous message in that peer conversation so a normal mail client can still thread them ([[analysis-mobile-mail-reply]]).
- Chat ignores subject threading. The conversation key is the normalized peer address.

## Who can be texted

Use the same recipient rule as compose autofill ([[analysis-pqpost-recipient-identity]]): exactly one verified, unrevoked `email` detail equal to that address, or a contact already pinned on the device. If lookup fails, the composer stays on the Mail path.

Outbound chat always encrypts and signs. There is no cleartext chat mode.

## What v1 leaves out

- Group threads. SMTP `Cc` does not match a group text thread.
- Attachments, typing indicators, presence, and delivery or read receipts. IMAP `\Seen` is the read state and already syncs across devices.
- A second IMAP folder. Leaving messages in the inbox keeps generic clients working. EBP's Mail view filters on the header.
- A realtime protocol. While Chat is open, use IMAP IDLE; otherwise poll on resume. Delivery stays store-and-forward ([[email-transport]]). Latency on the same Stalwart host can be short, and the UI should not promise instant delivery.
- Per-message ML-KEM cost. A later session key can reuse [[analysis-shared-key-concept]] after the first encrypted message. It is not required to ship the UI.

## Related

- [[analysis-email-backed-chat]]
- [[analysis-ebp-managed-email-onboarding]]
- [[analysis-pqpost-recipient-identity]]
- [[email-transport]]
- [[message-payload-formats]]
- [[component-gui]]
- [[component-mobile]]

## Sources

- Design discussion (2026-10-30). No raw source ingested.
- Cross-links: wiki pages above; `core/MessageHash.ts` purpose prefix `ebp::message::v1::`.
