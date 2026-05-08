---
title: "EBP Email Chrome Extension"
type: component
status: active
last_updated: 2026-05-07
source_count: 5
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

## Standards Context

The extension works with EBP armored JSON payloads, not OpenPGP messages or S/MIME/X.509 objects. [[openpgp-pqc]] and [[x509-pki]] are useful comparison pages for adjacent email security ecosystems, but they are not the extension's current wire format.

Because the extension operates inside webmail clients, it usually sees already-rendered compose and message content rather than acting as an SMTP or IMAP client itself. The same [[email-transport]] boundary still applies: provider mail transport and mailbox access carry the message, while EBP verification is based on the armored payload and cryptographic identity.

When users connect **Google** accounts, the OAuth client registered in Google Cloud is subject to Google's **verified vs. unverified** app rules (extra warnings, consent-screen behavior, and user caps until verification completes for sensitive/restricted scopes). That policy is orthogonal to EBP's own cryptography but affects whether Gmail flows work smoothly at scale; see [[source-google-cloud-unverified-apps]].

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
- [[email-transport]]
- [[identity-model]]
- [[message-payload-formats]]
- [[openpgp-pqc]]
- [[x509-pki]]
- [[overview]]
- [[source-google-cloud-unverified-apps]]

## Sources

- `ReadMe.md`
- `email/chrome-extension/`
- `wiki/raw/NIST.SP.800-57Pt3r1.pdf` → [[source-sp-800-57-part-3-r1]]
- `wiki/raw/rfc5321.txt` → [[source-rfc-5321]]
- `wiki/raw/Unverified apps - Google Cloud Platform Console Help.md` → [[source-google-cloud-unverified-apps]]
