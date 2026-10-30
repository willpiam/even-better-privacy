---
name: Managed mailbox lifecycle
overview: Let users restore mailbox access after a recovery-phrase restore, attach a mailbox to an existing identity on mobile, and delete a managed mailbox safely without allowing address takeover or proof replay.
todos:
  - id: gui-reset
    content: Fix GUI ebp-reset-password to fetch email from server and create account; add UI entry points
    status: pending
  - id: mobile-reset
    content: Add mobile resetEbpMailbox and entry points
    status: pending
  - id: mobile-use-existing
    content: Add mobile wizard Use this identity path with tests
    status: pending
  - id: server-delete
    content: Add server mail delete route with revoke-not-delete, retired_mail_usernames table, rate limit
    status: pending
  - id: client-delete
    content: Add GUI and mobile delete-mailbox actions with confirm
    status: pending
  - id: lifecycle-tests
    content: Server, GUI backend, live e2e, onboarding tests; update wiki
    status: pending
isProject: false
---

# Managed mailbox lifecycle: restore, use-existing on mobile, delete

## A. Restore access after a recovery-phrase restore
The server's `POST /api/v1/mail/reset-password` ([server/handlers/mail-signup.ts](server/handlers/mail-signup.ts) 281-344) already works for a restored identity. It checks a signed `ebp-mail::password-reset` detail with a 10-minute window.

The GUI local route `/api/v1/mail/ebp-reset-password` ([gui/local-backend/routes.ts](gui/local-backend/routes.ts) 4560-4631) breaks after a restore, because it reads `identity.getDetail("email")`. An identity restored with `/hd/identity` has no details. The route also never creates the local account.

GUI:
- If there is no local email detail, fetch `GET /identity/:fp` from the key server. Require `details.email` to be verified and at the domain from `fetchEbpMailConfig`.
- Extract the account-saving code from `/mail/ebp-signup` (around 4530-4548) into `saveEbpMailAccount()`. Reset calls it when no matching account exists.
- Entry points:
  - The onboarding 409 "this identity already has a mailbox" in [gui/js/onboarding.js](gui/js/onboarding.js) becomes a "Restore access" button.
  - Add a "Restore EBP mailbox access" button on the Mail Account tab ([gui/index.html](gui/index.html) around 4106).
  - After HD restore or discover in [gui/app.js](gui/app.js) (561-640), show a hint when the identity has a verified managed address.

Mobile:
- Add `resetEbpMailbox()` in [mobile/src/services/mail/ebpSignup.ts](mobile/src/services/mail/ebpSignup.ts):
  1. Fetch the email from the server.
  2. Sign `buildMailPasswordResetDetail` on a cloned identity, so the real `detailsNonce` is not consumed.
  3. POST the reset.
  4. Save with `buildEbpMailAccountRecord` + `saveMailAccountWithSecrets`.
- Entry points: the wizard's 409 error, [mobile/src/screens/mail/MailAccountsScreen.tsx](mobile/src/screens/mail/MailAccountsScreen.tsx), and a hint after discovery in `HdCreateScreen.tsx`.

## B. Mobile "Use this identity"
[mobile/src/screens/OnboardingWizardScreen.tsx](mobile/src/screens/OnboardingWizardScreen.tsx) `runCreate` (180-237) already skips key generation when `identityName` is set.
- On the welcome card (265-285), add a `onboarding-use-current` button, shown when `getCurrentIdentity()` returns an identity.
- That path keeps the username step, prompts for the existing identity password, and skips the password, phrase, and confirm steps. It then publishes and signs up.
- Tests: add a case in `mobile/__tests__/ebpSignupLogic-test.ts` for step sequencing (extract a pure `wizardSteps(useExisting)`), and a Maestro `onboarding-existing.yaml` up to the expected mail-server error.

## C. Delete a mailbox
Server: `POST /api/v1/mail/delete` taking `{fingerprint, proof}`.
- The proof is a signed detail at a new `MAIL_DELETE_PATH = "ebp-mail::delete"`, with detail `${email}|delete`, defined in [core/MailUsername.ts](core/MailUsername.ts). It uses the same freshness window as reset and no nonce, so a restored identity can still delete.
- Order of operations:
  1. Stalwart `destroyUser` (`server/stalwart.ts`).
  2. **Revoke** the `email` detail by setting revoked_at instead of calling `deleteDetail`. This keeps nonce history, so an old signup proof cannot be replayed.
  3. Insert the username into a new `retired_mail_usernames` table.
  4. Delete the `mailboxes` row.
- Usernames stay retired permanently, so nobody can take over an address that other people have pinned to the old identity. `isMailboxUsernameTaken` and `GET /mail/username-available` check the retired table.
- The same identity can sign up again with a new username, because signup already allows that when the old detail is revoked.
- Schema: add the table to [server/db/sqlite.ts](server/db/sqlite.ts) and [server/db/postgres.ts](server/db/postgres.ts), and add db functions in [server/db/index.ts](server/db/index.ts).
- Add a route in [server/main.ts](server/main.ts) and a rate limit of 5 per hour in [server/rate-limit.ts](server/rate-limit.ts).
- Clients:
  - GUI: a local route `/api/v1/mail/ebp-delete` that signs, POSTs, and removes the local account and secrets, plus a "Delete mailbox" button on managed accounts that opens a confirm modal where the user types the address.
  - Mobile: `deleteEbpMailbox()` and a button in `MailAccountSetupScreen.tsx`, next to the local-only "Delete account".

## Tests
- [server/tests/mail_signup_test.ts](server/tests/mail_signup_test.ts):
  - Delete happy path.
  - Stale or mismatched proof is rejected.
  - A retired username is unavailable.
  - Replaying the old signup proof fails after delete.
  - The same identity can sign up again with a new name.
- `gui/local-backend/tests/`: reset with no local detail creates the account.
- Add reset-then-IMAP-login and delete steps to `scripts/pqpost_mail_e2e.ts`.
- GUI e2e in `gui/e2e/onboarding.spec.ts`: the 409 shows Restore access (mocked).
- Update [[analysis-mobile-pqpost-readiness]] and [[analysis-ebp-managed-email-onboarding]].
