---
name: Desktop locked-first reader
overview: Port the mobile locked-first encrypted mail reader and sender-authenticity badge to the desktop GUI, moving the shared authenticity logic into core/ so the GUI backend returns the same fields as mobile.
todos:
  - id: core-authenticity
    content: Move mailAuthenticity helpers into core/MailAuthenticity.ts with tests; re-export from mobile
    status: pending
  - id: decrypt-route
    content: Enrich /api/v1/decrypt with opaque From matching and badge fields; mirror in test_handler.ts
    status: pending
  - id: reader-markup
    content: "Restructure reader markup: badge, locked placeholder, technical-details disclosure"
    status: pending
  - id: reader-js
    content: Locked branch in renderSelectedMailMessageBody, in-place plaintext, badge wiring, auto-decrypt when unlocked
    status: pending
  - id: auth-modal
    content: Add sender authenticity modal and fingerprint_mismatch mapping
    status: pending
  - id: reader-tests
    content: Add mocked mail-reader e2e spec and backend tests; update wiki
    status: pending
isProject: false
---

# Locked-first encrypted reader on desktop

## Today
- [gui/index.html](gui/index.html) (around 3770-3862) shows EBP mail as raw armor in `#mail-message-body`. Below it are a manual `#mail-sender-contact` input, `#mail-decrypt-btn`, and a one-line `#mail-verify-result` / `#mail-verify-meta`.
- `/api/v1/decrypt` in [gui/local-backend/routes.ts](gui/local-backend/routes.ts) (3540-4064) only checks the cleartext `email` claim. It never checks `opaque::email`, and it returns no `contactName`, `isKnownContact`, or `matchedEmailPath`.
- Mobile already has the logic as pure TypeScript in [mobile/src/services/mail/mailAuthenticity.ts](mobile/src/services/mail/mailAuthenticity.ts) (`matchFromToIdentity`, `deriveBadgeKind`, `badgeLabel`, `getDetailMeta`), and its only dependency is `core/MessageHash.ts`.

## Steps
1. **Move the logic to core.** Create [core/MailAuthenticity.ts](core/MailAuthenticity.ts) from `mailAuthenticity.ts`, plus `elevateUnknownSignerVerifyStatus` from `ebpMailLogic.ts`. Re-export from the mobile files so existing mobile imports keep working. Move `mobile/__tests__/mailAuthenticity-test.ts` cases into `core/MailAuthenticity.test.ts`.
2. **Enrich `/api/v1/decrypt`.**
   - In each signed branch, call `matchFromToIdentity`. Contacts already carry `resolvedOpaqueDetails`.
   - Add `matchedEmailPath`, `opaqueEmailMatched`, `isKnownContact`, `contactName`, `messageFrom`, `badgeKind`, and `badgeLabel` to the response. The frontend cannot import `core/`, so the backend computes these.
   - Mirror the change in [gui/local-backend/tests/test_handler.ts](gui/local-backend/tests/test_handler.ts), which `main_test.ts` runs instead of `routes.ts`.
3. **Change the reader markup** in `gui/index.html`:
   - Put `#mail-authenticity-badge` (a `result-badge` button) next to the From row.
   - Add `#mail-reader-locked`, a placeholder card reading "This message is encrypted", with `#mail-decrypt-btn` as its primary action, placed above the body.
   - Keep `#mail-message-body` / `#mail-message-html-wrap` for non-EBP mail and for decrypted plaintext, so the existing e2e selectors still work.
   - Add a `<details id="mail-technical-details">` holding the armor, the payload type, and the `#mail-sender-contact` input, relabeled "Override sender".
4. **Rendering in [gui/js/mail.js](gui/js/mail.js).**
   - `renderSelectedMailMessageBody` gets a locked branch when `selectedMailMessage.ebpPayload` is set: hide the body and show the placeholder.
   - The decrypt handler replaces the placeholder with plaintext in the body slot and sets the badge from `badgeKind` / `badgeLabel`. Map good to valid, caution to warning, bad to invalid, and neutral to pending.
   - When the identity session from the session-unlock plan is active, auto-decrypt on open. Otherwise show a one-click Decrypt.
5. **Sender authenticity modal.** Add `#mail-authenticity-modal`, a `.modal.modal-wide` following the contact-detail pattern in [gui/js/modals.js](gui/js/modals.js), with a close button, backdrop handling, an Escape entry, and a z-index below the password modal. Its sections mirror `MailSenderAuthenticityScreen.tsx`: who signed, email claims compared with From, endorsement, and signature. Auto-open it when the signature is invalid.
6. **Smaller fixes** in [gui/js/render.js](gui/js/render.js):
   - Map `fingerprint_mismatch` in `updateVerifyResult`.
   - Drop `renderMailVerifyMeta`'s bullet line in favor of the modal.
   - Encrypted attachments show their status with the same badge vocabulary.

## Tests
- New mocked Playwright spec `gui/e2e/mail-reader.spec.ts`:
  - The locked view hides the armor.
  - Decrypt with a mocked `/decrypt` fills the body and the badge.
  - The badge opens the modal.
  - Technical details shows the armor.
- The existing tests in `mail.spec.ts` (370-645) must still pass.
- Backend tests cover `opaque::email` From matching and the new response fields.
- Update [[analysis-mobile-encrypted-mail-reader-ux]] and [[component-gui]] to note GUI parity.
