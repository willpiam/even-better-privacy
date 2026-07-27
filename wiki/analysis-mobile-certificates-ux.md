---
title: "Mobile Certificates UX Alignment"
type: analysis
status: active
last_updated: 2026-07-27
source_count: 4
tags:
  - analysis
  - mobile
  - hierarchy
  - ux
  - certificates
---

# Mobile Certificates UX Alignment

How [[component-mobile]] Certificates / hierarchy propose should match app-wide
secrets UX and [[component-gui]] hierarchy propose patterns.

## Verdict

`CertificatesScreen` previously kept an always-visible identity password field
and two raw master/child fingerprint text inputs. That diverged from:

- Mobile crypto/mail screens: password via `useSecretPrompt` → `PasswordModal`
- GUI certificates: role (I am Master / Child) + contact search for the other
  party; password via `requestPassword` modal

Aligned (2026-07-27):

| Concern | Standard | Certificates now |
|---------|----------|------------------|
| Identity password | Popup at action time (`useSecretPrompt`) | Propose / Accept only |
| Other party | Contact search (name or fingerprint) | `ContactPicker` with `selectValue="fingerprint"` |
| Role | Current identity is one side | “I am the Master” switch |
| Reject | No password in GUI | Uses public fingerprint metadata; no unlock |
| Tree root | Contact or fingerprint | Same `ContactPicker` + `resolveContactFingerprint` |

## Code surface

- `mobile/src/screens/CertificatesScreen.tsx`
- `mobile/src/hooks/useSecretPrompt.tsx` / `PasswordModal.tsx`
- `mobile/src/components/ContactPicker.tsx` (`selectValue: 'name' \| 'fingerprint'`)
- `mobile/src/services/contacts.ts` (`resolveContactFingerprint`)
- `mobile/src/services/hierarchy.ts` (`rejectorFingerprint` without unlock)

## Remaining out of scope

- Mail compose still has an inline identity password field (same class of drift).
- Expiry is still a raw unix-ms field on mobile; GUI uses a date input.

## Related

- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-contact-display-component]]
- [[component-mobile]]
- [[component-gui]]

## Sources

- `gui/index.html` (Propose Hierarchy form)
- `gui/app.js` / `gui/js/hierarchy.js` / `gui/js/contact-search.js`
- `mobile/src/screens/crypto/EncryptMessageScreen.tsx` (password + ContactPicker pattern)
- `mobile/src/screens/CertificatesScreen.tsx`
