---
title: "EBP Managed Email Onboarding"
type: analysis
status: active
last_updated: 2026-10-25
source_count: 8
tags:
  - analysis
  - email
  - onboarding
  - stalwart
  - server
  - gui
  - mobile
---

# EBP Managed Email Onboarding

The desktop GUI and Android app share a "Get started" wizard. It creates an
[[ebp-hd|EBP-HD]] identity (24-word recovery phrase), publishes it to the
[[component-server|key server]], and provisions `username@<MAIL_DOMAIN>` on a
self-hosted Stalwart mailbox. The identity then carries a server-verified
`email` detail, and the device stores a mail account so the inbox can open
without a manual IMAP/SMTP form.

This is separate from the seed idea in [[analysis-email-backed-chat]], which
sketches fingerprint local-parts on a catch-all domain. Managed signup uses a
user-chosen local-part and a real mailbox principal.

## Why the mail server is not on Render

The key server stays on Render and only speaks HTTPS. Render does not expose
public SMTP or IMAP ports, and outbound port 25 is blocked on every plan. Mail
therefore runs on a small VPS. Clients sign up through the key server; they
read and send mail by talking to Stalwart directly.

```
clients --(signed signup, HTTPS)--> key server (Render) --(JMAP)--> Stalwart (VPS)
clients --(IMAP 993 / SMTP 465)------------------------------> Stalwart (VPS)
```

`mail-server/` documents a Stalwart Docker compose stack, DNS (MX, A for
`mail.`, SPF, DKIM, DMARC, optional MTA-STS), PTR/rDNS to `mail.<domain>`, and
the admin API token. Hetzner CX22 is the suggested VPS (port 25 unblock after
the first invoice); Vultr is the fallback. DigitalOcean is a poor fit because
it blocks port 25. On Cloudflare, the `mail.` A record must be DNS-only.

Registry RDAP lookups on 2026-10-18 found `pqpost.com` (recommended),
`pqmail.org`, `ebpmail.org`, and `ebpmail.net` unregistered. `ebpmail.com`,
`pqmail.com`, `pqmail.net`, `pq.email`, and `ebp.email` were already taken.
`pqpost.com` was registered on 2026-10-20 through Cloudflare (nameservers
`holly.ns.cloudflare.com` and `johnny.ns.cloudflare.com`, expiration
2027-10-20). That name is the production `MAIL_DOMAIN`. Signup stays off
until Stalwart is running.

## Signup API

Gated by `MAIL_SIGNUP_ENABLED` (default off) plus `MAIL_DOMAIN`, `MAIL_HOST`,
`STALWART_ADMIN_URL`, `STALWART_ADMIN_TOKEN`, and optional `MAIL_QUOTA_BYTES`.
`GET /api/v1/mail/signup/config` returns `{ enabled, domain, imap, smtp }` so
clients do not hard-code hosts. When Stalwart is not configured, `enabled` is
false.

| Method | Path | Role |
|---|---|---|
| `GET` | `/api/v1/mail/signup/config` | Domain and connection info |
| `GET` | `/api/v1/mail/username-available?u=` | Reserved names, `mailboxes` row, local rules |
| `POST` | `/api/v1/mail/signup` | Create the mailbox and verified `email` detail |
| `POST` | `/api/v1/mail/reset-password` | Identity-signed secret reset for a restored device |

Signup requires a published, unrevoked identity, at most one mailbox per
fingerprint, and a signed `email` detail proof for `username@MAIL_DOMAIN`
(`verifyDetailProof`). The server inserts a `mailboxes` row, creates the
Stalwart principal over JMAP (`x:Account/set` on Stalwart v0.16+), then writes
the detail and sets `verified_at` because the server issued the address.
Stalwart owns the mailbox secret; the key server does not store a password
hash. If principal creation or the detail write fails, the principal and the
mailbox row are rolled back.

Username rules live in `core/MailUsername.ts`: 3–30 characters, `[a-z0-9.-]`,
no leading/trailing or doubled dots or hyphens, and a reserved list (`admin`,
`postmaster`, `abuse`, and similar). The mailbox password is generated on the
device (32 hex characters).

Password reset takes a fresh identity-signed proof (nonce + timestamp) whose
detail binds the address to a hash of the new secret, then calls Stalwart
set-secret. That is how a recovery-phrase restore on a new device gets back
into the mailbox.

Rate limits in `server/rate-limit.ts`: signup 3 per hour per IP, password reset
5 per hour, availability 60 per minute.

## Wizard

Same steps on [[component-gui]] (`gui/js/onboarding.js`) and
[[component-mobile]] (`OnboardingWizardScreen`):

1. Welcome.
2. Username, with a debounced availability check.
3. Identity password, using [[password-policy]].
4. 24-word phrase, confirmed by three randomly chosen words.
5. Create: HD identity, publish, sign the `email` proof, `POST /api/v1/mail/signup`, save the local mail account.
6. Done: address, fingerprint, Open inbox. Host, ports, and mailbox password stay behind "Use in other mail apps".

GUI entry: first run with no identities, and a Mail-page button. The local
backend route `POST /api/v1/mail/ebp-signup` unlocks the identity, signs the
proof, forwards to the key server, and saves the account. Mobile entry: empty
Identities home and Mail accounts. Mobile I/O is `services/mail/ebpSignup.ts`;
pure helpers are `ebpSignupLogic.ts`. The account is stored with
`saveMailAccountWithSecrets`.

The existing advanced identity create and manual mail setup flows stay in
place.

## Abuse and deliverability

Open signup can be abused to send spam. Controls are the rate limits, one
mailbox per published identity, Stalwart per-account quota and outbound rate
limit, authenticated submission only, and the `MAIL_SIGNUP_ENABLED` kill
switch.

A new domain and IP will land in spam at first. DKIM, DMARC, and rDNS are
required, and warm-up takes weeks. See [[email-transport]] for the boundary
between SMTP/IMAP and EBP end-to-end payloads.

## Future work: EBP-owned post-quantum DKIM

The first `pqpost.com` deployment lets Stalwart generate the DKIM key during
its setup wizard (2026-10-25). That key is classical (RSA or Ed25519).
Receivers such as Gmail check it to decide whether the message came from this
domain. It is separate from the post-quantum signatures inside an EBP payload.

This is a stopgap. EBP should later take ownership of DKIM: generate and store
the signing key itself, sign outbound mail, and publish the public key. The
algorithm should become post-quantum once receiving mail servers can verify
such signatures. Until then, classical DKIM stays in place so mail is
deliverable.

## Related Pages

- [[email-transport]]
- [[analysis-email-backed-chat]]
- [[component-server]]
- [[component-gui]]
- [[component-mobile]]
- [[ebp-hd]]
- [[password-policy]]
- [[identity-model]]

## Sources

- `mail-server/README.md`, `mail-server/docker-compose.yml`
- `server/handlers/mail-signup.ts`, `server/stalwart.ts`, `server/rate-limit.ts`
- `server/db/postgres.ts`, `server/db/sqlite.ts`, `server/db/index.ts`
- `core/MailUsername.ts`
- `gui/js/onboarding.js`, `gui/local-backend/routes.ts`
- `mobile/src/screens/OnboardingWizardScreen.tsx`, `mobile/src/services/mail/ebpSignup.ts`, `mobile/src/services/mail/ebpSignupLogic.ts`
