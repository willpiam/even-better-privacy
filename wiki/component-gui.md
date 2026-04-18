---
title: "EBP GUI Component"
type: component
status: active
last_updated: 2026-04-10
source_count: 3
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

The loader page polls the sidecar health endpoint and redirects to `http://127.0.0.1:8787/` once ready. This avoids stale-frontend issues with Cargo caching. See [[analysis-linux-build]] for details.

## Native Email

The GUI includes a built-in email interface:

- Connects directly over SMTP and IMAP protocols.
- Supports OAuth with Gmail (and partially Outlook).
- Proton Mail users need Proton Mail Bridge running.
- Email operations integrate with EBP sign/encrypt/decrypt/verify flows. See [[message-payload-formats]] for the wire format.

## Key Features

- All CLI features in a graphical format.
- Contact management with server fetch/publish.
- Sign, encrypt, decrypt, verify messages.
- File encryption and decryption.
- Identity generation and switching.
- Detail management (attach, revoke, push).

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
- [[component-email-extension]]
- [[component-server]]
- [[analysis-linux-build]]
- [[identity-model]]
- [[message-payload-formats]]
- [[overview]]

## Sources

- `ReadMe.md`
- `gui/local-backend/main.ts`, `gui/local-backend/routes.ts`
- `gui/index.html`, `gui/app.js`, `gui/js/`
