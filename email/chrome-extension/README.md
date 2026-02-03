# EBP Gmail Chrome Extension

This Chrome extension integrates EBP encryption/decryption into Gmail by
calling the local EBP GUI backend API.

## Features

- Encrypt the current compose body into an EBP payload block.
- Decrypt EBP payloads found in received messages.
- Pick a recipient from your EBP contacts (loaded from the local backend).
- Configure backend URL and identity name via the extension options page.

## Prerequisites

- EBP running: `deno task gui`
- Gmail open in Chrome at `https://mail.google.com`

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable Developer Mode.
3. Click **Load unpacked** and select this folder:
   `/home/william/projects/even-better-privacy/email/chrome-extension`

## Usage

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
