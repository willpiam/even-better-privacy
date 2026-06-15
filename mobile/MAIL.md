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

## Deep links

- Android: `AndroidManifest.xml` intent-filter for `ebp` scheme
- iOS: `Info.plist` `CFBundleURLTypes` for `ebp`
