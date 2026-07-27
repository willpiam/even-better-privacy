---
title: "Email-Backed Chat (Brainstorm)"
type: analysis
status: seed
last_updated: 2026-07-27
source_count: 0
tags:
  - brainstorm
  - chat
  - email
  - fingerprint
  - transport
  - ux
---

# Email-Backed Chat (Brainstorm)

**Status: seed brainstorm — not a committed design.** Captures a product idea:
present a chat-like UI while the transport remains ordinary email, addressed by
EBP fingerprint.

## Idea

Users see threads, bubbles, and presence-ish UX. Under the hood, every message
is still an SMTP/IMAP message carrying an EBP signed/encrypted payload
([[email-transport]], [[message-payload-formats]]).

Addressing sketch:

```
<ebp-fingerprint>@williamdoyle.ca
```

or, later, a dedicated domain bought for the product (e.g. something like
`chat.ebp…` / a short brand domain). The local-part is the contact’s
[[identity-model|identity fingerprint]]; the domain is a catch-all mailbox
realm the chat client knows how to poll and submit through.

## Why it might be cool

- Reuses EBP’s existing end-to-end model instead of inventing a new realtime
  protocol.
- Fingerprint-as-address makes identity the primary routing key — closer to
  “talk to this cryptographic person” than “talk to this mailbox account.”
- Chat UX can hide MIME, armor, and mail headers from day-to-day use while
  keeping email as a durable, interoperable carriage layer.
- A dedicated domain makes the product feel intentional; a personal domain
  (`williamdoyle.ca`) is fine for a prototype / dogfood realm.

## How it could sit on current EBP

| Layer | Role |
| --- | --- |
| Chat UI | Thread list, compose, read receipts UI (local), typing indicators (optional / fake) |
| Mapping | Fingerprint ↔ `local-part@domain`; contact book already keyed by fingerprint |
| Crypto | Existing encrypt+sign paths; optional later [[analysis-shared-key-concept\|shared keys]] for cheaper multi-message sessions |
| Transport | SMTP submit + IMAP poll ([[email-transport]]); same security boundary as today’s mail |

This is a **presentation and addressing** layer on top of mail, not a
replacement for SMTP/IMAP semantics.

## Open design questions

### Local-part length and fingerprint form

Bech32 identity fingerprints (`ebpdk1…` / `ebpsk1…` over a 32-byte merkle root)
land at roughly **64 characters**. RFC 5321’s common local-part length limit is
also 64 octets. That means “full fingerprint as local-part” is at the edge of
what many MTAs accept.

Options if anything truncates or rejects:

- Use full fingerprint only if empirically accepted by the chosen domain’s MX.
- Use a shorter deterministic local-part (hash truncation / separate HRP) and
  keep the full fingerprint in the EBP payload / headers for authenticity.
- Split identity: short routable alias detail vs full fingerprint (weaker —
  alias becomes a new trust surface).

**Uncertainty:** exact on-wire fingerprint string length and provider acceptance
should be measured before committing to full-fp local-parts.

### Domain and mailbox architecture

- **Catch-all on one domain:** all `*@domain` land in one or more mailboxes;
  client filters by local-part / headers.
- **Per-user provisioning:** each fingerprint gets a real mailbox (heavier ops).
- **Personal domain vs product domain:** personal is fine for experiment;
  product domain avoids mixing personal mail reputation with chat traffic and
  clarifies ToS / abuse handling.

### Chat UX vs email reality

Email is store-and-forward, not realtime. A chat UI should set expectations:

- Delivery can be seconds to minutes (or fail silently at relays).
- No true online presence unless something else is added.
- Threading must map to `Message-ID` / `In-Reply-To` / `References` (see also
  mobile reply work in [[analysis-mobile-mail-reply]]).
- Spam, greylisting, and provider rate limits become product bugs from the
  user’s point of view.

### Metadata and privacy

SMTP/IMAP still expose routing, timing, and mailbox metadata
([[email-transport]] security boundary). A fingerprint-as-address also publishes
“this fingerprint receives mail at this domain” to anyone who can observe MX
traffic or directory scrape — which may be desirable for discovery or
undesirable for quiet identities.

Opaque email details ([[identity-model]]) are a related but different pattern
(hide cleartext email on the key server). Fingerprint@domain is the opposite
direction: make the fingerprint the public mailbox.

### Abuse and spam

Open catch-all + public fingerprints invites spam to every identity. Mitigations
to brainstorm later: require first contact to be an EBP-signed payload, reject
unsigned mail at the chat ingress, rate limits, optional Hashcash-like costs
(historical context only — [[hashcash-cost-functions]]; not currently part of
EBP).

## Rough product shapes

1. **Dogfood prototype:** catch-all on `williamdoyle.ca`, GUI/mobile “Chat”
   tab that is IMAP+SMTP with fingerprint addressing and EBP payloads.
2. **Product domain:** buy a domain, same architecture, clearer branding and
   reputation isolation.
3. **Interop mode:** chat addresses still work as ordinary email for non-chat
   EBP clients (extension/GUI mail) — strongest argument for staying on real
   SMTP.

## Non-goals (for this brainstorm)

- Replacing the key/discovery [[component-server]].
- Claiming chat-grade latency or presence.
- Committing to a domain name or mailbox ops model.

## Related

- [[email-transport]]
- [[identity-model]]
- [[message-payload-formats]]
- [[analysis-shared-key-concept]]
- [[component-gui]]
- [[component-mobile]]
- [[overview]]

## Sources

- Conversation brainstorm (2026-07-27); no raw source ingested.
- Cross-links only: existing wiki pages above.
