# EBP Mail Chrome Extension

This Chrome extension integrates EBP encryption/decryption into supported
webmail clients by calling the local EBP GUI backend API.

## Features

- Toolbar popup showing the currently selected local account.
- One-click account switching between local identities.
- Encrypt the current compose body into an EBP payload block.
- Decrypt EBP payloads found in received messages.
- Pick a recipient from your EBP contacts (loaded from the local backend).
- Configure backend URL and identity name via the extension options page.

## Prerequisites

- EBP running: `deno task gui`
- Gmail, Outlook, or Proton Mail on web open in Chrome (`https://mail.google.com`, `https://outlook.office.com`, or `https://mail.proton.me`)

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable Developer Mode.
3. Click **Load unpacked** and select this folder:
   `/home/william/projects/even-better-privacy/email/chrome-extension`

## Usage

### Switch account (popup)

1. Click the EBP Mail extension icon in Chrome's toolbar.
2. The popup shows the currently active local account.
3. Select another local account and click **Switch account**.

### Compose

1. Open a new compose window.
2. Select a contact from **Select EBP contact**.
3. Click **EBP Sign & Encrypt** to replace the compose body with an EBP payload.

### Read

1. Open an email containing an EBP payload block.
2. Click **Decrypt & Verify** to decrypt and view the message.

## Configuration

Open the extension options page to set:

- **Local backend URL** (default `http://localhost:8787`)
- **Identity name** (optional)
- **EBP home override** (optional)

## Payload Format

Messages are embedded into the email body as a JSON payload between markers:

```
-----BEGIN EBP MESSAGE-----
{ ...json... }
-----END EBP MESSAGE-----
```

The decrypt button only appears when this marker is present.

## Notes

- The extension does not map Gmail email addresses to EBP contacts; you must
  select an EBP contact by name.
- The local backend API currently allows CORS from any origin. If you want
  tighter control, add a shared token header and validate it server-side.

## Chrome Webstore justifications

> storage

Used to persist user settings so configuration survives browser restarts and syncs across the user's Chrome profile.

> Host permissions

Host permissions for supported webmail domains (mail.google.com, mail.proton.me, mail.protonmail.com, outlook.office.com, outlook.live.com, outlook.office365.com) are required so the extension can run its content script only on those sites, add EBP compose/read UI, and process message content in place when the user is actively using webmail.

Host permission for http://localhost:8787/* is required to call the local EBP backend API for contact lookup and cryptographic operations (encrypt/sign/decrypt/verify). This endpoint is on the user's machine.
