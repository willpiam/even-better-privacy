---
title: "EBP Website"
type: component
status: active
last_updated: 2026-04-28
source_count: 6
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

A client-side tool that verifies EBP signatures **locally** in the browser using `@noble/post-quantum` and `@noble/hashes` ESM bundles loaded from `esm.sh`. The configured EBP server is consulted only to resolve a published public identity by fingerprint (`GET /api/v1/identity/{fingerprint}`) and, optionally, to provide an advisory cross-check (`POST /api/v1/verify-signature`); the authoritative verified/invalid result always comes from the local cryptographic check. Default server URL: `https://ebp-cqyo.onrender.com`.

This client-side posture is the fix for finding F-WEB-01 in the [[security-audit-2026-04/findings|April 2026 security audit]] — see [[security-audit-2026-04/phase-05-cli-website-tauri]].

### Supported Signature Types

- **`ebp-signed-message`** (version 2) — paste or upload the signature JSON; the message is included in the payload.
- **`ebp-signature`** (version 2, detached) — paste the signature JSON and provide the original message in the Message textarea.
- **`ebp-signed-file`** — upload the file being verified; the verifier computes SHA-256 client-side via `crypto.subtle`, reconstructs the signed message (`ebp::filehash::{hash}::{salt}::{contextMessage}`), and locally verifies a detached-style payload against the supplied/fetched public identity. Shows a file-hash-mismatch error locally without contacting the server when hashes differ.

See [[message-payload-formats]] for canonical payload structures.

### Verification Pipeline

The verifier performs the same set of cross-checks as the GUI's `verify-file-form` flow, in roughly this order:

1. **Format** — payload JSON parse; bech32 fingerprint format check on the payload's `fingerprint` field and (if pasted) the public identity's `fingerprint` field. Uses the same HRPs as `core/Fingerprint.ts` (`ebpdk`, `ebpsk`).
2. **Cross-check fingerprints** — when both a payload `fingerprint` and an embedded `payload.identity.fingerprint` (or pasted public identity) are present, they must agree.
3. **Resolve signer identity** — the verifier prefers a pasted public identity, then a payload-embedded `identity`, and finally a `GET /api/v1/identity/{fingerprint}` server lookup as a last resort.
4. **Re-derive fingerprint from public keys** — recomputes the bech32 fingerprint from the resolved identity's `signingKey` + `encryptionKey` (mirroring `core/Fingerprint.ts::computeIdentityFingerprint`) and rejects the identity if the computed fingerprint does not match the claimed one. This closes the loophole where a hostile server (or a hostile pasted JSON blob) could pair a real fingerprint with a different `signingKey`, making an unrelated signature appear valid.
5. **Cryptographic verify** — `verifySignature()` in `website/crypto.js` builds the same hash envelope used by `core/MessageHash.ts` (`ebp::messagehash::<hash>::<salt>`) and calls `ml_dsa87.verify` or `slh_dsa_sha2_256s.verify` from `@noble/post-quantum`.
6. **Server advisory (optional)** — if reachable, `POST /api/v1/verify-signature` is called purely as a sanity-check; its `verified` boolean is reported alongside the local result as `serverAdvisory`/`serverConsistent`. The local result is authoritative.

### Inputs

- **Server URL** — configurable; defaults to the hosted Render instance. The verifier shows a confirmation prompt before contacting an `http://` URL (partial mitigation for F-WEB-02).
- **Signature JSON** — paste directly or upload a `.json` file (auto-populates the textarea).
- **Public identity JSON** — optional; if provided, the verifier validates that its `signingKey` + `encryptionKey` actually hash to the claimed `fingerprint` before using it.
- **Message** — for detached signatures (`ebp-signature` type).
- **File upload** — for `ebp-signed-file` payloads.

The configurable server URL is a URI-shaped input. [[source-rfc-3986]] provides the generic syntax and normalization background; scheme-specific HTTPS behavior and browser fetch behavior remain separate layers. See [[uri-syntax]] for the wiki's URL-handling notes.

### Output

The result panel shows a human-readable summary plus a JSON report with:

- `verified` — local cryptographic result (authoritative).
- `verifiedBy: "client"` — explicit reminder that the local check is the source of truth.
- `serverAdvisory` / `serverConsistent` — advisory cross-check status.
- `signerFingerprint` — bech32 fingerprint **recomputed from the resolved public keys**, plus `signerFingerprintConfirmedFromKeys: true`.
- `signerSource` — `"pasted"`, `"payload"`, or `"server"`.

When the signer is published on the configured server, the verifier also renders the signer's published details below the JSON report.

### Browser-Side Crypto (`crypto.js`)

`website/crypto.js` is the single browser module that mirrors the project's signing/verification primitives. It pulls pinned-version ESM bundles from `esm.sh`. The file intentionally uses a `.js` extension because some shared hosts do not serve `.mjs` with a JavaScript MIME type, and browsers reject module scripts when the MIME type is missing or incorrect.

- `@noble/post-quantum@0.5.4` — `ml_dsa87`, `slh_dsa_sha2_256s` (matches `core/Dilithium.ts` and `core/Sphincs.ts`).
- `@noble/hashes@1.8.0/sha2` — SHA-256 for hash envelopes.
- `bech32@2.0.0` — fingerprint encode/decode (same library used in `core/Fingerprint.ts`).

It exports `verifySignature`, `computeIdentityFingerprint`, `isValidFingerprintBech32`, and `sha256Hex`.

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
- [[uri-syntax]]
- [[identity-model]] — landing page describes fingerprint-based identity
- [[revocation-system]] — landing page describes revocation support
- [[overview]]

## Sources

- `website/index.html`
- `website/verify.html`
- `website/verify.js`
- `website/crypto.js`
- `website/privacy.html`
- `core/Fingerprint.ts`
- `core/MessageHash.ts`
- `wiki/raw/rfc3986.txt` → [[source-rfc-3986]]
