---
name: Email Render Toggle
overview: Add a global mail setting that controls whether opened emails are rendered as HTML or shown as plaintext, defaulting to plaintext for safety. Wire the setting into the current Message Reader flow and cover it with targeted UI test updates.
todos:
  - id: add-settings-checkbox
    content: Add global HTML rendering checkbox to Settings UI with default-off explanatory text.
    status: completed
  - id: persist-render-preference
    content: Add load/save preference logic in app state via localStorage and wire checkbox changes.
    status: completed
  - id: mail-reader-render-mode
    content: Update Message Reader DOM and logic to switch between plaintext and sandboxed HTML rendering based on preference.
    status: completed
  - id: keep-decrypt-compatible
    content: Ensure decrypt action and verification metadata still update correctly regardless of render mode.
    status: completed
  - id: add-e2e-coverage
    content: Add or update mail e2e test to validate default plaintext and enabled HTML render behavior.
    status: completed
---

# Plan: Add Optional HTML Email Rendering

## Goal

Add a user-controlled global preference (default **off**) so opened emails are either:

- shown as plaintext (current/safe behavior), or
- rendered as HTML when enabled.

## Implementation

1. **Add UI setting in Settings page**

- Add a checkbox in [`gui/index.html`](gui/index.html) under Settings, e.g. “Render HTML emails when opening messages”.
- Keep default unchecked and add brief warning text.

2. **Persist preference in GUI state**

- Extend state + preference loading in [`gui/app.js`](gui/app.js) using `localStorage` (GUI-only global setting).
- Initialize default to `false` if unset, and sync checkbox state on load.

3. **Render logic in Message Reader**

- In [`gui/index.html`](gui/index.html), add a safe HTML render container (hidden by default), while keeping existing plaintext textarea.
- In [`gui/app.js`](gui/app.js), update message-open flow so:
- if preference is off → show plaintext textarea (`detail.text || detail.html` as escaped text in textarea),
- if preference is on and `detail.html` exists → render HTML view,
- fallback to plaintext when no HTML part exists.
- Ensure decrypt flow still writes plaintext result and updates the reader consistently.

4. **Safety and behavior details**

- Render HTML in a sandboxed container (iframe-based) to avoid script execution and isolate email markup.
- Keep existing verification/decrypt controls unchanged.

5. **Tests**

- Update/add GUI e2e coverage in [`gui/e2e/mail.spec.ts`](gui/e2e/mail.spec.ts) for toggle behavior:
- default = plaintext,
- enabling setting switches viewer behavior for HTML-capable message details.

## Files to update

- [`gui/index.html`](gui/index.html)
- [`gui/app.js`](gui/app.js)
- [`gui/e2e/mail.spec.ts`](gui/e2e/mail.spec.ts)