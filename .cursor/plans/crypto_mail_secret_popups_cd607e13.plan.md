---
name: Crypto Mail Secret Popups
overview: Prompt identity passwords and mail PIN only via modal when needed, replace crypto boolean text fields with Switches, and restyle the existing PasswordModal for reuse.
todos:
  - id: secret-modal-hook
    content: Restyle PasswordModal + add useSecretPrompt hook
    status: completed
  - id: crypto-popup-switches
    content: "SignVerify/EncryptDecrypt: popup password when needed; Switch for booleans"
    status: completed
  - id: mail-pin-session
    content: "MailAccounts: session-start PIN modal; remove inline PIN form"
    status: completed
isProject: false
---

# Crypto Password Popups and Mail PIN Session Unlock

## Crypto: password only when needed

Today both [`SignVerifyScreen.tsx`](mobile/src/screens/SignVerifyScreen.tsx) and [`EncryptDecryptScreen.tsx`](mobile/src/screens/EncryptDecryptScreen.tsx) keep a permanent “Identity password” `TextField`.

**Change:** remove that field. Before any op that needs the private key, show a modal and pass the submitted password into that single call (do not keep it in a persistent screen field after success; cancel aborts the op).

| Action | Prompt password? |
|--------|------------------|
| Sign message / Sign file | Yes |
| Verify message / Verify file | No |
| Encrypt message / Encrypt file | Only if **Sign** is on |
| Decrypt message / Decrypt file | Yes |

Flow for Sign (already has confirm Alert): Confirm → password modal → run with password. Encrypt-with-sign: password modal then encrypt. Decrypt: password modal then decrypt.

## Crypto: booleans as Switches

Replace string `"true"/"false"` `TextField`s with Switch rows (same pattern as Settings):

- Sign/Verify: `detached`, `includeIdentity` → `boolean` state
- Encrypt/Decrypt: `sign`, `fileSign` → `boolean` state

Wire handlers to use the booleans directly (drop `=== 'true'` checks).

## Shared secret modal

Revive and restyle the unused [`PasswordModal.tsx`](mobile/src/components/PasswordModal.tsx):

- Design tokens + `AppButton` (not stock `Button`)
- Props: `visible`, `title`, `placeholder`, `submitLabel`, `onCancel`, `onSubmit`
- Clear input on open/submit/cancel

Add a small helper hook [`mobile/src/hooks/useSecretPrompt.ts`](mobile/src/hooks/useSecretPrompt.ts):

- Renders `PasswordModal`
- Exposes `promptSecret({ title, placeholder? }): Promise<string | null>` (null = cancelled)
- Used by both crypto screens and mail

## Mail: PIN popup at session start

In [`MailAccountsScreen.tsx`](mobile/src/screens/mail/MailAccountsScreen.tsx):

- Remove the inline Email PIN `TextField` / Unlock form
- On focus, if `getMailSecretsStatus` reports locked (encrypted on disk, not in memory), auto-present the PIN modal once for that focus cycle
- On success: existing `unlockMailSecretsWithPin` — secrets stay in memory for the app session (already how [`accountStore.ts`](mobile/src/services/mail/accountStore.ts) works), so later Mail screens do not re-prompt
- If user cancels: keep a short locked banner + **Unlock** button that reopens the same modal (no inline PIN field)

Do not add PIN prompts on Inbox/Compose unless secrets are locked mid-flow; those already throw “unlock with PIN first” — if needed, navigate/focus back to accounts unlock is enough for this pass.

## Out of scope

- Caching identity password across crypto ops
- Changing mail encryption / pin derivation
- Wiki updates
