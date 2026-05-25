---
title: "EBP GUI Component"
type: component
status: active
last_updated: 2026-05-24
source_count: 8
tags:
  - component
  - gui
  - frontend
  - deno
  - tauri
---

# GUI Component

The GUI provides a graphical interface over the same identity and crypto workflows exposed by the [[component-cli|CLI]]. It consists of a local backend server and an HTML/JS frontend.

## Architecture

- **Local backend** (`gui/local-backend/`): a Deno HTTP server on `http://127.0.0.1:8787` that serves the frontend and exposes REST API endpoints for all EBP operations. The entrypoint is `main.ts`, with route dispatch in `routes.ts` and domain logic split across `http.ts`, `identity.ts`, `contacts.ts`, `mail-account.ts`, `mail-imap.ts`, `mail-oauth.ts`, and `hierarchy-local.ts`.
- **Frontend** (`gui/index.html` + `gui/app.js` + `gui/js/`): a single-page application that communicates with the local backend. The JS is organized into ES modules under `gui/js/` (state, UI helpers, modals, crypto utilities, contact search, renderers, hierarchy SVG, mail, revocation) with `app.js` as a thin bootstrap.
- **Shared data model**: the GUI reads and writes the same `~/.ebp/` identity and contact files as the CLI. Both interfaces operate on the same data.

## Running

- **From source:** `deno task gui` (or `deno task gui:local-backend` then navigate to `http://localhost:8787`)
- **Desktop app:** distributed as an AppImage (Linux), DMG (Mac), or MSI (Windows). See [[analysis-linux-build]] for the build process.

## Desktop App Architecture

The desktop app bundles two binaries inside a Tauri shell:

1. **Tauri shell** (`ebp`): a Rust binary creating a WebKit webview. Embeds a lightweight loader page from `desktop/dist/`.
2. **Sidecar** (`ebp-gui-backend`): the Deno-compiled local backend. Serves the full frontend and all API endpoints.

The loader page polls the sidecar health endpoint and redirects to `http://127.0.0.1:8787/` once ready. This avoids stale-frontend issues with Cargo caching. See [[component-desktop]] and [[analysis-linux-build]] for details.

## Native Email

The GUI includes a built-in email interface:

- Connects directly over SMTP and IMAP protocols. [[source-rfc-5321]] anchors SMTP as the mail transport layer, while [[source-rfc-9051]] anchors IMAP4rev2 as the mailbox access layer.
- Supports OAuth with Gmail (and partially Outlook) via the local backend's authorization-code flow (`gui/local-backend/mail-oauth.ts`): browser redirect to Google, callback on `127.0.0.1`, code exchange through [[component-server]] so secrets stay server-side. Google's web-server flow, `state` CSRF parameter, offline refresh tokens, and redirect-uri registration rules are summarized in [[source-google-oauth2-web-server]]. Until the Google Cloud OAuth client completes [app verification](https://support.google.com/cloud/answer/9110914) for the scopes in use, Google may label the client **unverified**, show additional consent warnings, and cap **new** users (100 total after the unverified screen); see [[source-google-cloud-unverified-apps]]. For reacting to Google Account compromise or token revocation at scale, see [[source-google-cross-account-protection-risc]] (not yet implemented in EBP).
- Proton Mail users need Proton Mail Bridge running.
- Email operations integrate with EBP sign/encrypt/decrypt/verify flows. Message selection now uses bounded/cancelable load behavior plus lazy encrypted-attachment payload fetch to reduce reader stalls. See [[message-payload-formats]] for the wire format.

SMTP and IMAP do not provide EBP's end-to-end message security. The GUI uses them to send and fetch mail, then applies EBP payload encryption and signature verification at the application layer; see [[email-transport]] for the standards boundary.

## Key Features

- All CLI features in a graphical format.
- Contact management with server fetch/publish.
- Sign, encrypt, decrypt, verify messages.
- Native email body + attachment encryption/decryption (MIME-native encrypted attachments).
- File encryption and decryption.
- Identity generation and switching.
- Detail management (attach, revoke, push).
- Settings page: server URL, mail preferences, stored mail credentials, and
  [[password-policy]] enforcement toggle for new identities (`localStorage` key
  `ebp.identity.enforcePasswordPolicy`, default on).

## Toast Notification System

The GUI uses a single `#status` element rendered as a fixed-position toast at the bottom-center of the viewport. All user-facing feedback (success, error, info) flows through the `setStatus(msg, kind)` function in `gui/js/ui.js`.

- **Kinds:** `"success"` (green), `"error"` (red), `"info"` (accent blue, default).
- **Auto-dismiss:** non-error toasts hide after 5 seconds; errors persist until replaced.
- **Animation:** slides up from bottom on each new message.

## File Save / Download

Download buttons (sign, encrypt, sign-file, encrypt-file, decrypt-file) save through the local backend rather than browser blob-URL downloads. This avoids silent failures in the Tauri/WebKitGTK desktop webview where programmatic `<a>` downloads do not work.

- Frontend POSTs content and a suggested filename to `POST /api/v1/save-file`.
- Backend writes to `~/Downloads/` and returns the full path.
- The toast notification displays the saved file path.

## Related Pages

- [[component-cli]]
- [[component-desktop]]
- [[component-email-extension]]
- [[component-server]]
- [[analysis-linux-build]]
- [[email-transport]]
- [[identity-model]]
- [[password-policy]]
- [[message-payload-formats]]
- [[overview]]
- [[source-google-cloud-unverified-apps]]
- [[source-google-oauth2-web-server]]
- [[source-google-cross-account-protection-risc]]

## Sources

- `ReadMe.md`
- `gui/local-backend/main.ts`, `gui/local-backend/routes.ts`, `gui/local-backend/mail-oauth.ts`
- `gui/index.html`, `gui/app.js`, `gui/js/`
- `wiki/raw/rfc5321.txt` → [[source-rfc-5321]]
- `wiki/raw/rfc9051.txt` → [[source-rfc-9051]]
- `wiki/raw/Unverified apps - Google Cloud Platform Console Help.md` → [[source-google-cloud-unverified-apps]]
- `wiki/raw/Using OAuth 2.0 for Web Server Applications  _  Authorization.md` → [[source-google-oauth2-web-server]]
- `wiki/raw/Protect user accounts with Cross-Account Protection  _  Cross-Account Protection (RISC).md` → [[source-google-cross-account-protection-risc]]
