---
title: "EBP Website"
type: component
status: active
last_updated: 2026-04-09
source_count: 4
tags:
  - component
  - website
  - static
  - verifier
---

# Website

The public website (`website/`) is a static, framework-free mini-site serving as the project's marketing presence and hosting a browser-based signature verifier. It is plain HTML, CSS, and vanilla JavaScript with no build step.

## Pages

| File | Purpose |
|---|---|
| `index.html` | Landing page — positioning, feature overview, getting-started links |
| `verify.html` + `verify.js` | Browser-based signature verification tool |
| `privacy.html` | Privacy policy (mirrors `PRIVACY.md`) |
| `styles.css` | Shared stylesheet for all pages |

## Landing Page (`index.html`)

Presents EBP as a "practical successor to PGP, built for the next era of cryptography." Content sections:

- **Why EBP** — three cards covering post-quantum design ([[ml-dsa]], [[slh-dsa]], [[ml-kem]]), [[identity-model|identity-centered security]], and [[revocation-system|revocation controls]].
- **How It Works** — five-step workflow: generate identity, share fingerprint, import contacts + sign/verify/encrypt/decrypt, [[component-email-extension|Chromium email plugin]], revocation.
- **How to Get It** — links to GitHub releases (desktop), `deno task gui` ([[component-gui]]), and `deno task cli` ([[component-cli]]).
- **CTA** — standards convergence and collaboration pitch; links to GitHub.

## Signature Verifier (`verify.html`)

A client-side tool that verifies EBP signatures by delegating to the [[component-server|server]]'s `POST /api/v1/verify-signature` endpoint. Default server URL: `https://ebp-cqyo.onrender.com`.

### Supported Signature Types

- **`ebp-signed-message`** — paste signature JSON; optionally provide the original message for detached signatures.
- **`ebp-signed-file`** — upload the file being verified; the verifier computes SHA-256 client-side via `crypto.subtle`, reconstructs the signed message (`ebp::filehash::{hash}::{salt}::{contextMessage}`), and sends a detached-style payload to the server. Shows a file-hash-mismatch error locally if hashes differ without making a server call.

### Inputs

- **Server URL** — configurable; defaults to the hosted Render instance.
- **Signature JSON** — paste directly or upload a `.json` file (auto-populates the textarea).
- **Public identity JSON** — optional; if provided, sent alongside the payload so the server can verify against a supplied key rather than a published one.
- **Message** — for detached signatures (`ebp-signature` type).
- **File upload** — for `ebp-signed-file` payloads.

### Output

Displays the server's JSON response, a human-readable summary (valid/invalid/mismatch), and published signer details when available.

## Privacy Page (`privacy.html`)

Static rendering of the project's privacy policy: minimal data collection, only public keys/signatures/details stored, no private keys or message content. Links to the canonical `PRIVACY.md` on GitHub.

## Deployment and Assets

- No build toolchain — files are served as-is.
- Images (logo, promo artwork) load from GitHub raw URLs (`raw.githubusercontent.com/willpiam/even-better-privacy/master/assets/`).
- Nav links reference `https://williamdoyle.ca/ebp/privacy.html` as the deployed privacy policy URL, suggesting the site is hosted at `williamdoyle.ca/ebp/`.
- Favicon also loads from GitHub raw.

## Design

Warm, minimal aesthetic using CSS custom properties (`--brand: #d36f2f`, `--bg: #f7f4ee`, `--surface: #fffdf8`). Responsive grid layout collapses to single-column below 900 px. No JavaScript on the landing or privacy pages.

## Related Pages

- [[component-server]] — hosts the verify-signature API the verifier calls
- [[component-cli]] — referenced in "How to Get It"
- [[component-gui]] — referenced in "How to Get It"
- [[component-email-extension]] — referenced in "How It Works"
- [[identity-model]] — landing page describes fingerprint-based identity
- [[revocation-system]] — landing page describes revocation support
- [[overview]]

## Sources

- `website/index.html`
- `website/verify.html`
- `website/verify.js`
- `website/privacy.html`
