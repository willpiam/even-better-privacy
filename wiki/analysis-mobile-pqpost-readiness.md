---
title: "Mobile Readiness for pqpost.com"
type: analysis
status: active
last_updated: 2026-10-30
source_count: 4
tags:
  - analysis
  - mobile
  - email
  - onboarding
  - pqpost
---

# Mobile Readiness for pqpost.com

Android can complete a first-run `@pqpost.com` signup and then read and send
mail over the hosts the key server returns. It does not yet cover every
managed-mail path the server and desktop GUI expose.

`pqpost.com` is the production `MAIL_DOMAIN`. Signup is enabled. Mail between
`@pqpost.com` addresses works. Delivery to other providers still waits on
Hetzner opening outbound port 25. That limit is on the VPS, not in the app.
See [[analysis-ebp-managed-email-onboarding]].

## What the Android app already does

The app does not hard-code `pqpost.com`. `OnboardingWizardScreen` calls
`GET /api/v1/mail/signup/config` and uses the returned domain plus IMAP and
SMTP endpoints. The wizard then:

1. Checks the local-part with `GET /api/v1/mail/username-available`.
2. Creates a 24-word [[ebp-hd]] identity under [[password-policy]].
3. Publishes that identity.
4. Signs an `email` detail and `POST`s `/api/v1/mail/signup`.
5. Stores the mailbox with `saveMailAccountWithSecrets` (IMAP 993 / SMTP 465
   when the server marks those endpoints secure).

Entry points are the empty Identities home and Mail accounts. After signup,
the existing mail stack (inbox, compose, encrypted reader, reply) is the
client for that mailbox. Implicit TLS via `TcpSocket.connectTLS` matches
Stalwart's 993/465 ports. See [[component-mobile]] and
[[analysis-mobile-imap-smtp-inbox-empty]].

## What is still missing

| Need | Mobile status |
|---|---|
| New identity plus `@pqpost.com` mailbox | Implemented |
| Read and send on the provisioned mailbox | Implemented; no live-mailbox device test |
| Attach a mailbox to an identity that already exists | Implemented on both clients. Mobile welcome shows **Use this identity** when an identity is current. |
| Recovery-phrase restore back into the same mailbox | Implemented. Both clients call `POST /api/v1/mail/reset-password` and save a new mailbox secret locally. |
| Delete the mailbox | Implemented. `POST /api/v1/mail/delete` revokes the email detail and retires the username. The user must type the address. |
| iOS install of this flow | Not documented. The wizard is in the React Native app; the recorded install path is Android. |
| Mail to Gmail and other providers | Not an app gap. Outbound port 25 is still closed. |
| Post-quantum DKIM | Not an app gap. Stalwart's classical DKIM key is the current deliverability stopgap. |

Maestro `onboarding.yaml` stops at mailbox provisioning and expects an error
when Stalwart is unreachable. `deno task test:pqpost-mail` talks to the live
domain from the server test harness, not from a phone. See
[[analysis-mobile-testing-and-gui-gaps]].

## Related Pages

- [[analysis-ebp-managed-email-onboarding]]
- [[component-mobile]]
- [[component-gui]]
- [[component-server]]
- [[email-transport]]
- [[analysis-mobile-testing-and-gui-gaps]]
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[analysis-mobile-standalone-install]]

## Sources

- [[analysis-ebp-managed-email-onboarding]]
- [[component-mobile]], [[component-gui]], [[component-server]]
- `mobile/src/screens/OnboardingWizardScreen.tsx`, `mobile/src/services/mail/ebpSignup.ts`, `mobile/src/services/mail/ebpSignupLogic.ts`
- `gui/js/onboarding.js`, `gui/local-backend/routes.ts` (`/api/v1/mail/ebp-reset-password` has no UI caller)
