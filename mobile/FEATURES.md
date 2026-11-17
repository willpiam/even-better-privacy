# Mobile feature inventory

This lists the mobile app's user-visible capabilities without deciding which are
core to the product. Related controls are grouped so they can be reviewed and
removed together. Entries in the normal-app tables remain available after the
bloat cleanup; the development tools are restricted as described below.

## Development and debugging

These controls are available only in development builds. Release navigation does
not register Diagnostics or Mail trace, and its bundle omits those screens, the
Developer section, and the crypto self-test/parity vectors.

| ID  | Feature                                  | What it exposes                                                                                                                                                                        |
| --- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Core self-test                           | Creates an in-memory identity and checks a signature.                                                                                                                                  |
| 2   | Crypto parity diagnostics                | Argon2id and mail PBKDF2 checks against known vectors.                                                                                                                                 |
| 3   | System diagnostics                       | On-device identity storage directory.                                                                                                                                                  |
| 4   | Mail trace                               | Opt-in recording, refresh, and clear; newest 200 events, memory-only for this app process. No protocol logging or trace storage writes in release.                                     |
| 5   | Test addresses and test-network checkout | Settings toggle for `@test.pqpost.com`, Ethereum Sepolia/Cardano preview payment assets, checkout/recovery flows. A saved development preference cannot activate this mode in release. |

Sources: `src/components/DeveloperTools.tsx`, `src/screens/DiagnosticsScreen.tsx`,
`src/screens/mail/MailTraceScreen.tsx`, `src/screens/SettingsScreen.tsx`,
`src/services/settings.ts`, `src/screens/OnboardingWizardScreen.tsx`.

## App information and settings

| ID  | Feature                      | Controls or content                                                                                                 |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 6   | About EBP                    | Large illustration, project description, How It Works, security note, GitHub and project-site links.                |
| 8   | Mail help                    | Provider-specific Gmail/Proton Bridge instructions and generic IMAP/SMTP guidance.                                  |
| 9   | Custom key server            | Global server URL and a separate per-publish override on an identity.                                               |
| 10  | Password-policy preference   | Toggle enforcement when creating identities.                                                                        |
| 11  | Session security             | Auto-lock after 5/15/60 idle minutes and Lock now.                                                                  |
| 12  | HTML mail preference         | Optional HTML rendering in a restricted WebView; plain-text rendering is the default.                               |
| 13  | Include public keys in mail  | Preference controlling public-key inclusion in EBP messages.                                                        |
| 14  | Protocol and server metadata | Server URL and protocol version on the identity home screen; algorithm/server/fingerprint metadata in detail views. |

Sources: `src/screens/{ProjectInfoScreen,SettingsScreen,IdentitiesHomeScreen,IdentityDetailScreen}.tsx`,
`src/screens/mail/MailHelpScreen.tsx`.

## Identity creation and management

| ID  | Feature                              | Controls or behavior                                                                                 |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 15  | Multiple local identities            | List, select current identity, switch identity context, unlock.                                      |
| 16  | Manual HD identity creation/recovery | Generate or enter a mnemonic, confirm it, optional passphrase, local name and encryption password.   |
| 17  | Advanced HD derivation               | Account, index, external/internal change chain; discovery on the server with raw discovery output.   |
| 18  | Alternate signing profile            | ML-DSA or SLH-DSA selection for HD identities.                                            |
| 19  | Identity overview                    | Publication and email verification indicators; links to focused management screens.                                     |
| 20  | Overwrite existing identity          | Explicit overwrite switch in manual HD creation.                                        |
| 21  | Import/export identity files         | Create/import through the home-screen plus menu; export encrypted identity files from Export and backup. |
| 22  | Public identity export               | JSON output with separate switches for signing key, encryption key, and details; copy/share output.  |
| 23  | Publish to key server                | Publish an unpublished identity on a focused screen, with an optional server override; show a check when published.                            |
| 24  | Attach identity details              | Arbitrary detail path/value, opaque hash-only publication, optional push to server.                  |
| 25  | Email ownership verification         | Request verification for cleartext or opaque email details; replace completed actions with verified indicators.                                          |
| 26  | Emergency revocation certificate     | Generate and copy a certificate for revoking the identity later.                                     |
| 27  | Revocation and local deletion        | Revoke a detail, revoke the identity, optional reason/server push, or delete its local device file.  |

Sources: `src/screens/{IdentitiesHomeScreen,HdCreateScreen,IdentityDetailScreen,IdentityActionsScreen}.tsx`.
Recovery, revocation, and auto-lock are security capabilities even if their screens
are considered secondary; removing an entry point should be an explicit product
choice.

## Contacts

| ID  | Feature                   | Controls or behavior                                                                                                                |
| --- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 28  | Local contacts            | List/select contacts, import public JSON manually, fetch a contact by fingerprint, delete locally.                                  |
| 29  | Server identity directory | Browse/search identities on the configured server.                                                                                  |
| 30  | Local contact annotations | Alias, description, and local email address separate from published identity details.                                               |
| 31  | Contact synchronization   | Refresh published details and revocation status from the server.                                                                    |
| 32  | Opaque-detail resolution  | Enter an opaque path and candidate plaintext value to check a hash-only detail.                                                     |

Sources: `src/screens/{ContactsScreen,ContactDetailScreen}.tsx`.

Parent–child certificate management is deferred from v1. The existing certificate
storage, protocol, and validation code remains for compatibility. HD mnemonic
creation/recovery, encrypted backups, emergency revocation certificates, and
ordinary identity revocation remain available. A future interface belongs under
Identity → Keys and recovery, with a read-only relationship view on contacts;
it needs guided child replacement, rotation, revocation, and interrupted-operation
repair before returning to the mobile UI.

## Standalone crypto tools

These are the separate Crypto tab, distinct from encryption/signature verification
performed as part of mail. All remain available.

| ID  | Feature                | Controls or behavior                                                                                                                      |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 36  | Sign text              | Attached or detached signature, include identity, include random salt; JSON output, copy and share.                                       |
| 37  | Verify text            | Attached or detached payload, optional original message, sender contact; optional pasted/imported public keys instead of a saved contact. |
| 38  | Sign files             | File picker, context message, optional salt and displayed generated salt; share signed payload.                                           |
| 39  | Verify files           | File picker and signed payload; show hash/signature verification result.                                                                  |
| 40  | Encrypt text           | Choose recipient, optionally sign, emit copyable/shareable encrypted payload.                                                             |
| 41  | Decrypt text           | Paste encrypted payload, choose sender where needed, view plaintext output.                                                               |
| 42  | Encrypt files          | File picker, recipient, optional signing, share output.                                                                                   |
| 43  | Decrypt files          | Encrypted payload and sender input; decrypt and share/save recovered file.                                                                |
| 44  | Fingerprint calculator | Paste public identity JSON and compute its fingerprint.                                                                                   |
| 45  | Advanced file inputs   | Manual file URI on sign/verify/encrypt screens; file-name and MIME overrides on file encryption.                                          |

Sources: `src/screens/CryptoHubScreen.tsx`, `src/screens/crypto/*Screen.tsx`.
Removing these screens would not remove the core cryptography needed for mail.

## Mail and account setup

| ID  | Feature                            | Controls or behavior                                                                                                                     |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 46  | Multiple mail accounts             | Select accounts per identity, edit/delete local account configuration, remember encrypted credentials or keep them in memory.            |
| 47  | Arbitrary IMAP/SMTP provider setup | Manual host/port/TLS fields, username, separate IMAP/SMTP passwords, From address/name, and account label.                               |
| 48  | Mail connection test               | Test IMAP and SMTP before saving an account. This is account-setup assistance and remains in normal builds.                              |
| 49  | Mailbox access recovery/deletion   | Restore managed-mailbox access with the identity; server deletion with typed address confirmation, separate from local account deletion. |
| 50  | Inbox, folders, search and paging  | Read mailbox folders, search, select page/limit, refresh, open individual messages.                                                      |
| 51  | Compose and reply                  | Recipient chips/contact resolution, subject/body, encrypted EBP mail or an explicit unencrypted-recipient choice; sent-folder copies.    |
| 52  | Plain-mail attachments             | Add/remove attachments to unencrypted mail. Encrypted attachments are currently refused by mobile compose.                               |
| 53  | Message reading and decryption     | Read plain text or optional HTML, decrypt EBP messages, reply after sender-bound decryption.                                             |
| 54  | Sender authenticity details        | Detailed explanation of signer/contact/fingerprint, published and From email, opaque matching, server identity and verification status.  |
| 55  | Technical message view             | Expand Wire / armor payload and Decrypt again. Remains in normal builds for review; separate from the removed release developer menu.    |

Sources: `src/screens/mail/{MailAccountsScreen,MailAccountSetupScreen,MailInboxScreen,MailComposeScreen,MailMessageScreen,MailSenderAuthenticityScreen}.tsx`.

Sending now runs in an app-level queue. After validation and unlock, compose
returns to the previous screen while a snackbar shows encryption, SMTP delivery,
and saving to Sent. Delivery failures preserve recipients, text, attachments and
reply headers for **Edit message**. **Retry save** only retries the IMAP copy;
it never submits the email again. The queue pins the original mail account.
Jobs and recoverable drafts are memory-only and do not survive app termination.

Mail signing/encryption runs in a fresh local WebView runtime outside Hermes,
with network access blocked by CSP and no persistent storage. The runtime is
removed after each job. Rebuild its checked-in bundle with
`npm run build:mail-crypto` after changing the crypto core; normal start, Android,
iOS and Android release scripts do this automatically. Verify it with
`npm run check:mail-crypto` and `npm run test:mail-crypto` (desktop Chromium;
set `CHROMIUM_PATH` when needed).

## Managed mailbox onboarding

| ID  | Feature                            | Controls or behavior                                                                                                                                                |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 56  | Guided identity plus mailbox setup | Choose username, password, generate recovery phrase, confirm selected words, create identity and managed mailbox with progress/retry status.                        |
| 57  | Use an existing identity           | Attach/restore a mailbox using the selected identity rather than generating a new one.                                                                              |
| 58  | Checkout handoff                   | Display a checkout URL, copy/share/open it, recover a pending order, and retry provisioning where enabled by the server. Test-network options are development-only. |
| 59  | Other mail-app settings            | After signup, reveal connection details for configuring the mailbox in another mail client.                                                                         |
| 60  | Alternative setup entry points     | Empty-state onboarding buttons, manual setup escape hatch, and Create an EBP email address from Mail accounts.                                                      |

Source: `src/screens/OnboardingWizardScreen.tsx`.

## Cleanup implemented

- About artwork uses a 1024×1024 mobile JPEG (315,736 bytes) instead of bundling
  the shared PNG (1,858,523 bytes). The original shared artwork stays available
  to the website and other clients.
- Removed unused `@react-native/new-app-screen`, `react-native-libsodium`, their
  unused transitive packages, and the obsolete libsodium startup service.
- Identity Argon2id and mail PBKDF2 share Quick Crypto; parameters and encrypted
  storage remain compatible. Native device parity is a release check.
- Android releases enable R8 optimization and resource shrinking.
- Message verification calls the shared verifier exercised by parity tests.
- Mail tracing is opt-in, bounded, memory-only, and disabled in release.
- Developer screens/checks are excluded from release; test-mail settings ignore
  persisted development preferences in release.
- Removed the stale Bun lockfile. Mobile builds use npm and `package-lock.json`.

## Validation and footprint

| Measurement                 | Before          | After           |
| --------------------------- | --------------- | --------------- |
| About artwork               | 1,858,523 bytes | 315,736 bytes   |
| Android Metro assets        | 1,900,527 bytes | 357,743 bytes   |
| Android minified JavaScript | 2,501,680 bytes | 2,478,793 bytes |
| Android Hermes bytecode     | 3,790,640 bytes | 3,752,028 bytes |
| Autolinked native libraries | 15              | 14              |

These are bundle/build-input measurements, not APK or App Store download sizes.
Native library and R8 savings require a native release build.

All 197 Jest tests pass, including storage/vector interoperability, exact Unicode
and whitespace password handling, native-error propagation, message verification,
trace limits/opt-in, and release test-mail gating. Android and iOS production JS
bundles build, and both exclude the developer screens, checks, vectors, test-mail
toggle, removed dependencies, and original large PNG. Hermes compilation and
lint of changed TypeScript/JavaScript pass (lint retains existing `no-void`
warnings). The project-wide TypeScript check has existing errors; comparison
with the original checkout found no new diagnostics.

Android/iOS native rebuilds and device checks have not run in this environment,
which has no Android SDK or Xcode. The device parity and release integration
checks are listed in `NATIVE_CRYPTO.md`; the development Maestro flow is
`e2e/developer.yaml`.
