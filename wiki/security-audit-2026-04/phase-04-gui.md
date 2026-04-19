---
title: "Phase 4 — GUI local backend & frontend review"
type: analysis
status: completed
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-4
  - gui
---

# Phase 4 — GUI local backend & frontend review

Part of the April 2026 [[README|EBP Security Audit]]. Covers [`gui/local-backend/`](../../gui/local-backend) (~3.2k LOC, with `routes.ts` alone at 2.8k lines) and [`gui/js/`](../../gui/js).

## Summary

The GUI local backend is the most dangerous attack surface in the project. It binds to `127.0.0.1:8787` by default (good), but it sets `Access-Control-Allow-Origin: *` on every response, performs no `Host:` validation, no `Origin:` validation, and uses no CSRF token. Combined with the wide Deno permission set granted by `deno task gui` (`--allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys`), this means **any web page the user visits in any browser**, while the GUI/desktop app is running, can read the user's identity list, contacts, mail-account metadata, hierarchy data, and write arbitrary files into `~/Downloads/`. This is the highest-severity issue uncovered by the audit so far.

The good news: the password-protected operations (sign / decrypt / private-key export) require the user's password as a request field, so they cannot be invoked silently from a cross-origin context. And HTML email rendering uses an `<iframe sandbox="" srcdoc="...">` with a strict CSP, defeating most HTML-mail XSS / pixel-tracker / SSRF attempts.

## What is correct

- Default bind `127.0.0.1` ([gui/local-backend/main.ts:35](../../gui/local-backend/main.ts)) — does not listen on `0.0.0.0` unless `GUI_BACKEND_HOST` is overridden.
- Static-file path-traversal protection in `tryServeStatic` — rejects `..` and `\\`, decodes URI safely.
- `/api/v1/save-file` filename validation rejects `/`, `\`, `.`, `..` (no path traversal). Files are forced into `~/Downloads/`.
- `/api/v1/mail/oauth/open-browser` URL-allowlist — only `https://` and `http://127.0.0.1` URLs accepted.
- `/api/v1/sign`, `/api/v1/encrypt`, `/api/v1/decrypt`, `/api/v1/identity/export-private`, etc. all require the user's password in the body — cross-origin attacker cannot directly forge those requests without the password.
- Front-end DOM rendering consistently uses `escapeHtml(...)` for user-controlled strings ([gui/js/render.js](../../gui/js/render.js), [gui/js/mail.js](../../gui/js/mail.js), [gui/js/hierarchy.js](../../gui/js/hierarchy.js)).
- HTML email rendering uses `<iframe sandbox="" srcdoc="...">` with `Content-Security-Policy: default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:;` ([gui/index.html:2780-2783](../../gui/index.html), [gui/js/mail.js:339-352](../../gui/js/mail.js)). Combined with the empty `sandbox=""` attribute, this gives strong isolation against active HTML email content.
- IMAP TLS verification: `imapflow` defaults to `tls.rejectUnauthorized = true`. Audit found no override.
- 84 core tests pass; GUI backend has its own test suite (not run here — tested in Phase 8).

## Findings

### F-GUI-01 — Cross-origin information disclosure & file write via `Access-Control-Allow-Origin: *` (Critical)

**Files:** [`gui/local-backend/http.ts:22-26`](../../gui/local-backend/http.ts), [`gui/local-backend/routes.ts:101-104`](../../gui/local-backend/routes.ts), entire route surface.

```ts
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
```

Every response carries `Access-Control-Allow-Origin: *`. `handleRequest` does NOT validate `Origin:` or `Host:`. There is no CSRF token on any state-changing route. This means **any web page a victim visits in any browser** while the GUI/desktop is running (and listening on `127.0.0.1:8787`) can issue cross-origin requests and read/write the responses.

What an attacker can do without the user typing a password:

| Endpoint | Impact |
|---|---|
| `GET /api/v1/identities` | Enumerate every local identity name + fingerprint on disk. |
| `GET /api/v1/identity/public?name=...` | Read public-identity blob (incl. all detail values) for any identity. |
| `GET /api/v1/contacts` | Exfiltrate user's full social graph (contact names, fingerprints, details). |
| `GET /api/v1/mail/accounts` | List configured mail accounts (provider, email address, hosts). |
| `GET /api/v1/hierarchy/...` | Read hierarchy relationships (org chart inference). |
| `GET /api/v1/context` | Get filesystem paths for `~/.ebp/` dirs — confirms EBP is installed and the OS user's home. |
| `POST /api/v1/save-file` | Write arbitrary content to `~/Downloads/<filename>` (no overwrite check, see F-GUI-03). |
| `POST /api/v1/mail/oauth/open-browser` | Open arbitrary `https://` URL in user's default system browser (silent phishing redirect). |
| `POST /api/v1/identity/use` | Change the user's "current identity" without their consent (sets up subsequent operations against an attacker-chosen identity). |
| `POST /api/v1/identity/generate` | Generate a new identity on the user's machine, optionally setting a known password. |
| `POST /api/v1/contact/upsert` (and friends) | Inject attacker-controlled fake "contacts" with attacker-supplied public keys, so future signature-verifies of attacker messages succeed against the contact name the user thinks belongs to a real person. |
| `POST /api/v1/mail/account/upsert` | Configure or modify mail accounts (potentially redirecting outgoing mail through attacker SMTP). |

What an attacker CANNOT do directly (mitigated by password requirement):
- Sign on behalf of an identity (`/api/v1/sign` requires `password`).
- Decrypt a message (`/api/v1/decrypt` requires `password`).
- Export private key.

But: any of the above unauthenticated routes is sufficient to **stage** a much more dangerous attack:
- Inject a fake contact, then later, when the user clicks "Verify signature from `Bob`", an attacker-signed message verifies as Bob.
- Replace the active mail account with one pointed at the attacker's SMTP — outgoing EBP mail goes to the attacker.
- Use `save-file` to drop a malicious binary in `~/Downloads/` named identically to a known download (e.g. an IDE installer the user is about to run).

**PoC:** [`pocs/F-GUI-01-cross-origin-csrf.html`](pocs/F-GUI-01-cross-origin-csrf.html). Open this file in a browser while `deno task gui` is running. Will dynamically verify in Phase 8.

**CVSS 3.1:** AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:H — 9.6 Critical.

**Fix (multiple, defence-in-depth):**
1. **Strict Origin allow-list**: only `null` (file://) and the known Tauri webview origin (e.g. `tauri://localhost`, `https://tauri.localhost`, `http://127.0.0.1:8787` if the static UI is served by the same origin) are allowed. Reject every other Origin with a 403, including missing-Origin from non-GET requests.
2. **DNS-rebinding defence**: validate `Host: 127.0.0.1:8787` (or `localhost:8787`); reject anything else.
3. **CSRF token**: at boot, the local backend writes a per-session secret to a file readable only by the user (e.g. `~/.ebp/.gui-session-token`). The Tauri webview / GUI frontend reads it and includes it as a header `X-EBP-Session: <secret>` on every state-changing request. Cross-origin tabs cannot read the file or guess the token.
4. **Bind only when desktop UI is loaded**: have Tauri spin up the backend on a randomly-chosen port and inject the port + token into the webview. Cross-origin attackers don't know the port.

The token-on-disk approach is what `npm` uses for its localhost daemon and what Cypress uses; well-validated pattern.

### F-GUI-02 — `/api/v1/save-file` allows silent overwrite of any file in `~/Downloads/` (High)

**File:** [`gui/local-backend/routes.ts:2799-2825`](../../gui/local-backend/routes.ts).

The handler validates the filename for path separators and `..` (good) but does NOT check whether the target file already exists. An attacker (whether cross-origin per F-GUI-01 or via on-disk extension) can overwrite any file in `~/Downloads/`, including:
- A binary the user just downloaded and is about to run (`installer.exe`, `Setup.dmg`, `tool.AppImage`).
- A config file the user is about to import.
- A signed `.ebp-encrypted-file` they expect to decrypt.

**Fix:** check `Deno.lstat(filePath)` first; if the file exists, return 409 unless an explicit `overwrite: true` flag is passed AND the request comes through a confirmed-trusted origin (per F-GUI-01 fix).

### F-GUI-03 — No body-size limit on local backend (High)

**Files:** [`gui/local-backend/http.ts:98-104`](../../gui/local-backend/http.ts) (`readJson`), all routes.

`readJson` calls `req.json()` directly. There is no Content-Length check, no streaming size cap. An attacker (per F-GUI-01) can POST a 1 GB JSON body to any route and exhaust memory. Combined with `--allow-write`, oversized `save-file` POSTs fill the user's disk.

**Fix:** mirror the `server/body.ts` pattern: enforce a `MAX_BODY_SIZE` (256 KB suggested for most routes; carve out `save-file` to e.g. 64 MB, with explicit content-length check before reading).

### F-GUI-04 — `--allow-run` shells out without per-call argument hardening (Medium)

**Files:** [`gui/local-backend/routes.ts:266`](../../gui/local-backend/routes.ts) (`mail/oauth/open-browser`).

The only code path that uses `Deno.Command` is the `open-browser` handler. The URL is validated to start with `https://` or `http://127.0.0.1`. On Windows, the `powershell` fallback uses single-quote escaping (`replace(/'/g, "''")`) which is correct PowerShell escaping. On Linux/macOS the URL is passed directly as an arg (no shell), so no command-injection. **Verified safe today.**

But: the per-OS command list is hardcoded and silently iterates fallbacks if early ones fail. If a future maintainer adds `bash -c` style invocation, the URL filter is not strict enough (it permits e.g. `https://;rm -rf /`). Recommend hardening the URL regex (`^https://[A-Za-z0-9._~%/?#=&:+-]+$`) to remove this risk class.

### F-GUI-05 — Password and message logged via `console.error(err)` on internal error (Low)

**File:** [`gui/local-backend/routes.ts:2832`](../../gui/local-backend/routes.ts).

```ts
} catch (err) {
  if (err instanceof HttpError) { ... }
  console.error(err);
  return json({ error: "internal server error" }, STATUS.InternalServerError);
}
```

`err` may include the original Error object whose `message` could embed parts of the request payload (depending on what threw). The local-backend `console.error` writes to stdout/stderr which on the Tauri-bundled deployment is captured by the parent shell and may end up in OS journals. Recommend: scrub before logging, or only log the error class + a stable message.

### F-GUI-06 — `/api/v1/identity/use` switches identity without user confirmation (Medium)

**File:** [`gui/local-backend/routes.ts:882`](../../gui/local-backend/routes.ts).

A cross-origin attacker (F-GUI-01) can quietly switch the active identity to one the attacker generated on the victim's box (via `/api/v1/identity/generate`). Subsequent user-initiated actions (signing, encrypting) then operate against the attacker-chosen identity. Coupled with a UI race, the user could sign a malicious message under an identity they didn't intend.

Mitigated entirely by F-GUI-01 fix.

### F-GUI-07 — Mail HTML iframe sandbox is empty (`sandbox=""`) but srcdoc CSP allows `style-src 'unsafe-inline'` (Low)

**Files:** [`gui/index.html:2780-2783`](../../gui/index.html), [`gui/js/mail.js:340`](../../gui/js/mail.js).

The combination is generally safe (`sandbox=""` blocks scripts entirely), but `style-src 'unsafe-inline'` permits CSS-based exfiltration via attribute selectors and `background-image: url(data:...)` doesn't apply to remote URLs because `default-src 'none'` blocks it. Verified no exfil vector. Document defence-in-depth: keep `sandbox=""` and consider `style-src 'self'` with a fixed stylesheet.

### F-GUI-08 — `/api/v1/mail/oauth/start` writes per-state record to in-memory map with no eviction beyond `pruneExpiredOAuthState` (Informational)

**File:** [`gui/local-backend/routes.ts:144`](../../gui/local-backend/routes.ts).

`mailOauthStarts` is an in-process `Map`. `pruneExpiredOAuthState` exists (need to inspect for correctness) but if an attacker (F-GUI-01) initiates many OAuth flows, the map grows. Mitigation: rate-limit + cap map size.

### F-GUI-09 — Frontend XSS surface relies on consistent `escapeHtml` (Informational, no exploit found)

**Files:** [`gui/js/render.js`](../../gui/js/render.js), [`gui/js/mail.js`](../../gui/js/mail.js), [`gui/js/hierarchy.js`](../../gui/js/hierarchy.js), [`gui/js/contact-search.js`](../../gui/js/contact-search.js).

Manually audited every `.innerHTML =` assignment against `state.*` and contact / detail / mail data. All concatenations of remote/external data flow through `escapeHtml`. Two patterns to flag for ongoing maintenance:
- `revocation.js` uses `<option value="">` with hardcoded text.
- `hierarchy.js` `tip.innerHTML = html` (line 18) — the `html` argument originates from a function that builds it from escaped data (verified), but a future change could regress this.

Recommend introducing an `escapeHtml` lint rule and / or migrating to a templating helper that auto-escapes by default (Lit-html-style).

## Static checks

```
$ deno lint gui/
Found 0 lint errors (only pre-existing test-file no-import-prefix warnings).
```
See `tooling-output/phase-04-deno-lint.txt`.

## Hand-off to Phase 5

Phase 5 covers the CLI, website verifier, and Tauri shell. Phase 4's F-GUI-01 finding is amplified by the Tauri shell because the desktop bundle starts the local backend automatically as a sidecar. Critical Phase 5 questions:
- Does the Tauri webview enforce a CSP that pins fetches to the local backend origin only?
- Does Tauri's `allowlist.shell.open=true` widen the attack surface beyond the open-browser handler already audited?
- Does the website verifier sanitize the JSON identity blob on paste?

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[phase-02-crypto-core]]
- [[phase-03-server]]
