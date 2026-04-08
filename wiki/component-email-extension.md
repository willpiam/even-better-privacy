---
title: "EBP Email Chrome Extension"
type: component
status: active
last_updated: 2026-04-08
source_count: 2
tags:
  - component
  - email
  - extension
  - chrome
---

# Email Chrome Extension

EBP ships a Chrome-compatible browser extension that adds sign/encrypt and decrypt/verify controls to webmail clients. It communicates with the local [[component-gui|GUI backend]] API at `http://127.0.0.1:8787`.

## Supported Webmail Clients

- **Gmail** (web)
- **Outlook** (Outlook on the web)
- **Proton Mail** (web)

Works on any Chromium-based browser (Chrome, Edge, Brave, etc.).

## Integration Model

1. The extension injects UI controls into the webmail compose/read interface.
2. User selects text and triggers sign/encrypt or decrypt/verify.
3. The extension calls the local EBP backend API to perform the cryptographic operation.
4. Results are inserted back into the webmail interface.

This means the EBP GUI local backend must be running for the extension to work.

## Installation

### From Source

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" and select `email/chrome-extension/`

### Chrome Web Store

Not yet published (planned).

## Build

The extension can be built into a `.crx` or `.zip` using `build_chrome_extension.sh`.

## Related Pages

- [[component-gui]]
- [[component-cli]]
- [[identity-model]]
- [[overview]]

## Sources

- `ReadMe.md`
- `email/chrome-extension/`
