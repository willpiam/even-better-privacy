---
name: Compose recipient chips
overview: Replace the GUI mode select plus contact/email rows and the mobile per-row To fields with a single To field that turns each address into a resolved chip, encrypting by default and warning before plaintext.
todos:
  - id: core-compose
    content: Add core/ComposeRecipients.ts (parseAddressList, deriveComposeIntent) with tests
    status: pending
  - id: gui-chips
    content: Build gui/js/compose-recipients.js chip field and resolve modal; replace mode select, To field, rows
    status: pending
  - id: gui-send
    content: Rewire GUI send handler and send-state to chip intent
    status: pending
  - id: mobile-chips
    content: Add RecipientChipsField, migrate MailComposeScreen and reply route params
    status: pending
  - id: mobile-attach-guard
    content: Block plaintext attachments on mobile encrypted sends
    status: pending
  - id: compose-tests
    content: Fix stale e2e helper, add GUI compose spec, Maestro flow, jest tests; update wiki
    status: pending
isProject: false
---

# Single To field with recipient chips (GUI and mobile)

## Today
- GUI [gui/index.html](gui/index.html) (3870-3945):
  - a `#mail-compose-mode` select (plain or ebp-encrypt)
  - `#mail-compose-to`, used only in plain mode
  - contact plus email rows built by `addComposeRecipientRow` in [gui/js/mail.js](gui/js/mail.js) (690-793)
- Mobile [mobile/src/screens/mail/MailComposeScreen.tsx](mobile/src/screens/mail/MailComposeScreen.tsx) has one To field per row with a per-row `encryptionIntent`, a `RecipientResolveModal`, and a plaintext banner.
- The backends need no change. `/mail/send-ebp` already takes `recipients[{contact,email}]` and builds one multi-recipient payload. `/mail/send` takes a joined `to`.

## Behavior (both apps)
- Typing an address and pressing comma, semicolon, Enter, or blur, or pasting a list, turns each address into a chip. Duplicates are dropped and invalid addresses show a red chip.
- Each chip resolves on its own:
  1. Local contact match first: `email`, plus `opaque::email` on mobile.
  2. Then the exact verified-email lookup on the key server.
- Chip states:
  - resolving
  - encrypted (lock icon and contact name)
  - unresolved (amber)
  - plaintext (red, set explicitly)
- Clicking an unresolved or encrypted chip opens a resolve dialog. It offers a contact picker and "not intended to be encrypted".
- Overall intent:
  - all encrypted: send encrypted
  - all plaintext: red banner, send plain
  - any resolving or unresolved, or a mix: send is blocked, with a message to remove plaintext recipients or send separately
- Reply adds the sender as a chip. On mobile, the existing signer-based `recipientContact` carries over.

## Shared logic
[core/ComposeRecipients.ts](core/ComposeRecipients.ts) with tests:
- `parseAddressList(text)` (split, trim, lowercase the domain, dedupe, validate)
- `deriveComposeIntent(chips)`
- a `ComposeChip` type

Mobile imports `core/` directly. The GUI frontend cannot, so it uses a small JS mirror of these two functions in the new module, kept in sync by a shared test fixture.

## GUI
- New [gui/js/compose-recipients.js](gui/js/compose-recipients.js), a chip field component:
  - Reuses `findContactForComposeRecipient`, matching by email, and the stale-safe `resolveComposeEmailFromServer` from `mail.js`.
  - Exposes `getChips()`, `setChips()`, and `onChange`.
- Markup: replace the mode select, `#mail-compose-to`, and the recipient rows with `#mail-compose-to-chips` (an input plus a chip list) and `#mail-compose-plaintext-banner`.
- Add a resolve dialog `#mail-recipient-resolve-modal` (contact search plus "Send unencrypted to this address") using the existing modal pattern.
- Send handler (around 1474-1539) and `updateMailComposeSendState` in [gui/js/contact-search.js](gui/js/contact-search.js): branch on `deriveComposeIntent`. Encrypted sends map chips to `recipients[{contact, email}]`; plaintext sends post `to = emails.join(", ")`.
- Remove the dead mode-switch code.

## Mobile
- New [mobile/src/components/RecipientChipsField.tsx](mobile/src/components/RecipientChipsField.tsx): a `TextInput` plus chips.
  - Resolution moves out of the screen from `resolveRecipientFromTo`, keeping the current-address stale check.
  - Tapping a chip opens the existing [mobile/src/components/RecipientResolveModal.tsx](mobile/src/components/RecipientResolveModal.tsx).
- `MailComposeScreen`: replace the `RecipientRow[]` state with chips, and replace `overallIntent` with `deriveComposeIntent`. In [mobile/src/navigation/AppNavigator.tsx](mobile/src/navigation/AppNavigator.tsx), rename the `initialRows` route param to `initialRecipients` and update the reply caller in `MailMessageScreen.tsx`.

## Related fix found during research
Mobile `sendEbpMail` ([mobile/src/services/mail/ebpMail.ts](mobile/src/services/mail/ebpMail.ts) 47-130) attaches files as **plaintext** MIME parts even when the body is encrypted. This plan blocks attachments on encrypted mobile sends and explains why in the UI. Porting the GUI's encrypted `-attachment-multi` flow is a separate follow-up.

## Tests
- Core unit tests for the parser and the intent function.
- Rewrite the stale `sendEncryptedEmail` helper in [gui/e2e/mail.spec.ts](gui/e2e/mail.spec.ts) (155-175), which targets the nonexistent `#mail-compose-recipient`.
- Add a mocked `gui/e2e/mail-compose.spec.ts` covering:
  - a pasted list producing chips
  - a mocked verified lookup producing an encrypted chip
  - an unresolved chip blocking send
  - marking a chip plaintext showing the banner
  - the request bodies for both send paths
- Add a Maestro `mobile/e2e/mail-compose.yaml` checking chip creation and the plaintext banner, plus jest tests for `RecipientChipsField` logic.
- Update the wiki: [[analysis-mobile-compose-recipient-resolve]], [[component-gui]].
