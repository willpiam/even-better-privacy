---
title: "Streamlining the Email Experience"
type: analysis
status: active
last_updated: 2026-10-30
source_count: 9
tags:
  - analysis
  - email
  - ux
  - gui
  - mobile
---

# Streamlining the Email Experience

Recommendations for reducing friction in EBP mail on [[component-gui]] and
[[component-mobile]], ranked by user impact. Covers native mail only; the wiki
has no page for the browser email extension.

## 1. Unlock once per session

The GUI asks for the identity password on every body decrypt, every encrypted
attachment decrypt, and every send (`requestPassword` calls in
`gui/js/mail.js`). A separate email PIN guards stored IMAP/SMTP secrets and
OAuth tokens. Reading one encrypted message with two attachments costs three
password prompts.

Recommended: unlock the identity once with an idle timeout. While unlocked,
decrypt EBP mail automatically on open and sign/encrypt on send without
prompting. For managed `@pqpost.com` accounts, derive or wrap the mailbox
secret under the identity unlock so the email PIN disappears. Mobile can add
biometric unlock, which [[analysis-mobile-encrypted-mail-reader-ux]] already
lists as later work.

## 2. Bring the desktop reader up to the mobile reader

The GUI reader shows the message in a raw textarea, so EBP mail renders as
armored JSON. Below it are a free-text "Sender contact name or fingerprint"
input, a **Decrypt EBP Payload** button, and a verification badge.

Mobile already ships a locked-first layout: decrypt above the fold,
ciphertext behind **Technical details**, plaintext in the body slot, and a
tappable authenticity badge with a sender drill-down
([[analysis-mobile-encrypted-mail-reader-ux]]). Port that layout to the GUI.
Move the manual sender field behind an override, since the sender can be
resolved from the payload fingerprint.

## 3. One compose model on both clients

GUI compose has a Mode dropdown (plaintext versus sign + encrypt) plus
recipient rows that each pair one EBP identity with one SMTP address. Mobile
uses an ordinary To field. Each address is resolved on blur, and an
unresolved address prompts for a contact pick or an explicit unencrypted send
([[analysis-mobile-compose-recipient-resolve]]).

Recommended: use the mobile model on both clients. Use a plain To field with a
per-recipient lock or unlocked chip. Encrypt by default when every recipient
resolves, and warn once before any plaintext send. Verified-email autofill
already exists on both clients
([[analysis-pqpost-recipient-identity]]), so recipient rows add work without
adding safety.

## 4. Close managed-mailbox lifecycle gaps

From [[analysis-mobile-pqpost-readiness]]:

- Restoring from the recovery phrase does not get the user back into their
  mailbox. `POST /api/v1/mail/reset-password` exists on the key server, and the
  GUI backend proxies it, but no screen calls it.
- The mobile wizard cannot attach a mailbox to an existing identity. The GUI
  offers this as **Use this identity**.
- Neither app can delete a mailbox.

The restore gap matters most. Users who reinstall or switch devices lose mail
access unless this flow exists.

## 5. Outbound delivery (ops, not app)

Mail between `@pqpost.com` addresses works. Mail to Gmail and other
providers is blocked until Hetzner opens outbound port 25. Once it opens,
domain and IP warm-up takes weeks
([[analysis-ebp-managed-email-onboarding]]). No app polish makes up for
messages that never arrive, so this belongs on the critical path.

## Related

- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-pqpost-recipient-identity]]
- [[analysis-mobile-pqpost-readiness]]
- [[analysis-ebp-managed-email-onboarding]]
- [[analysis-gui-mobile-parity-deltas]]
- [[email-transport]]

## Sources

- `gui/js/mail.js` (password and PIN prompts, decrypt and send handlers)
- `gui/index.html` (mail reader and compose markup)
- `gui/local-backend/routes.ts` (`/api/v1/mail/ebp-reset-password`)
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-pqpost-recipient-identity]]
- [[analysis-mobile-pqpost-readiness]]
- [[analysis-ebp-managed-email-onboarding]]
- [[component-gui]]
