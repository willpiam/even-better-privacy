# Mobile native mail stack

Parity v1 mail uses in-process IMAP/SMTP over TLS TCP sockets, matching the GUI
trust model (OAuth token exchange via the configured EBP server — no client
secrets in the app).

## Libraries

| Concern | Choice | Notes |
|---------|--------|-------|
| TLS TCP | `react-native-tcp-socket` | IMAP 993 / SMTP 465/587 |
| OAuth browser | React Native `Linking` | Custom redirect `ebp://mail/oauth/callback` |
| MIME / armor | `mobile/src/services/mail/mime.ts` | EBP armor extraction aligned with GUI |
| Crypto compose | `encryptDecrypt.ts` + `ebpMail.ts` | Same payloads as GUI `send-ebp` |

GUI uses Deno `ImapFlow` + Nodemailer; those are not Hermes-compatible, so mobile
implements a minimal line-protocol client instead of porting those modules.

## Install native dependency

After pulling parity changes, install dependencies (includes `react-native-tcp-socket`):

```bash
cd mobile
npm install
# or: bun install
```

Then restart Metro with a clean cache: `npm start -- --reset-cache`.

Rebuild the native app after adding the TCP module (`npm run android` / `npm run ios`).

## OAuth redirect

Register `ebp://mail/oauth/callback` in Google/Microsoft OAuth clients alongside
the desktop `http://127.0.0.1:8787/...` URI. Token exchange posts that redirect
to `POST /api/v1/mail/oauth/exchange` on the EBP server (same as GUI).

## OAuth client IDs

Mobile loads public OAuth client IDs from the configured key server:

`GET /api/v1/mail/oauth/config`

Set `MAIL_OAUTH_GMAIL_CLIENT_ID` and `MAIL_OAUTH_OUTLOOK_CLIENT_ID` in the
server `.env` (same as GUI). Client secrets stay on the server only.

For local development, optional overrides live in **Settings → Advanced**
(Gmail / Outlook OAuth client ID override). Overrides take precedence over the
server when non-empty.

## Storage layout

Per current identity: `DocumentDirectory/ebp/<identity>/mail-account.json` and
encrypted `mail-account.secrets.json` (PBKDF2 envelope, ported from GUI).

## Manual IMAP/SMTP accounts

From **Mail Accounts → Add manual account**, enter:

- Account label (display name)
- IMAP host, port, TLS
- SMTP host, port, TLS
- Username and separate IMAP / SMTP passwords (app passwords where required)
- From email and optional from name

**Persist passwords on this device** is on by default. When enabled, set an
**email PIN** on first save; passwords are encrypted into
`mail-account.secrets.json` (same envelope as the GUI).

Use **Test IMAP + SMTP** before saving to verify credentials. Mail credentials
are used only on-device over TLS; they are not sent to the EBP key server.

## Mail connection trace stubs

When **Test IMAP + SMTP**, inbox load, or send hangs, the mail stack records
step stubs (e.g. `tcp.connect.start`, `imap.greeting.wait`, `smtp.auth.wait`)
before each blocking await.

- **In-app:** Home → **Mail trace stubs** (newest first). Use the stack back
  gesture to leave a hung Test screen, then open the viewer — the last stub is
  the stall point.
- **Metro:** live lines tagged `[ebp-mail]` via `console.warn`.
- Stubs store host/port and protocol step names only — never passwords or tokens.
- **Test IMAP + SMTP** clears the trace at the start of each run.

## Unlock after restart

After restarting the app, open **Mail Accounts** and **Unlock mail secrets** with
your email PIN before opening the inbox. Unlock uses native PBKDF2
(`react-native-quick-crypto`); pure JS on Hermes is too slow for the 210k
iteration envelope used by the GUI.

## Native crypto (mail PIN)

Mail secrets use PBKDF2-HMAC-SHA-256 with 210,000 iterations (same as GUI).
After pulling changes that add `react-native-quick-crypto`, reinstall and rebuild:

```bash
cd mobile
npm install
cd ios && pod install && cd ..
npm run android   # or npm run ios
```

In **Settings → Diagnostics**, run **Verify mail PBKDF2 parity** once after a
native rebuild. Unlock should finish in a few seconds, not hang indefinitely.

Accounts created in the desktop GUI under the same identity use the same storage
files and can be unlocked on mobile with the same email PIN.

## Deep links

- Android: `AndroidManifest.xml` intent-filter for `ebp` scheme
- iOS: `Info.plist` `CFBundleURLTypes` for `ebp`
