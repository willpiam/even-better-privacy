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
  - local-backend
---

# Phase 4 — GUI local backend & frontend

Part of the April 2026 [[README|EBP Security Audit]]. Covers [`gui/local-backend/`](../../gui/local-backend) (~3.6k LOC, of which `routes.ts` is 2,835 lines) and the static frontend in [`gui/`](../../gui).

## Summary

The GUI local backend is the largest single attack surface in EBP. It is a Deno HTTP server bound to `127.0.0.1:8787` running with `--allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys` — i.e. the user's full filesystem and process privileges. **It serves CORS `*` on every response, performs no Host-header validation, and has no CSRF protection.** Any web page the user visits in the same browser can hit it and read most state-changing responses cross-origin. This is a Critical-class issue: F-GUI-01.

The frontend itself is well-coded: most `innerHTML` sinks are wrapped with `escapeHtml`, and HTML mail bodies are rendered in an iframe with both `sandbox=""` (max restrictions) AND a strict CSP `default-src 'none'`. That's a strong defense in depth and means HTML-mail XSS is contained.

## What is correct

- Default bind is `127.0.0.1` (not `0.0.0.0`). LAN-side attackers cannot reach the local backend without DNS rebinding.
- HTML mail rendering: `<iframe sandbox="" srcdoc="...CSP default-src 'none'...">` — execution is fully sandboxed even if the mail HTML contains `<script>`.
- `safeFileName` strips path separators, control chars, and `..` from filenames passed to `/api/v1/save-file`.
- `/api/v1/save-file` further rejects filenames containing `/`, `\`, `.`, or `..`.
- `/api/v1/mail/oauth/open-browser` allowlists URL schemes to `https://` and `http://127.0.0.1` only.
- Static-file serving (`tryServeStatic`) blocks `..` and `\` in decoded paths.
- All `innerHTML` insertions of user-controlled strings I sampled in `gui/js/render.js`, `gui/js/hierarchy.js`, `gui/js/mail.js`, `gui/js/contacts-search.js` are wrapped with `escapeHtml`.
- Subprocess invocation (`Deno.Command`) is restricted to a hard-coded list of OS-specific `xdg-open` / `open` / `rundll32` openers with the URL passed as an argv element (no shell). PowerShell fallback uses single-quote escaping (`replace(/'/g, "''")`) — fine for `Start-Process`.
- Mail credentials and OAuth refresh tokens are gated by a per-store PIN that is required to unlock; in-memory PIN cache exists with timeout.

## Findings

### F-GUI-01 — Universal cross-origin access to the local backend (Critical)

**Files:** [`gui/local-backend/http.ts:22-26`](../../gui/local-backend/http.ts), [`gui/local-backend/routes.ts:101-104`](../../gui/local-backend/routes.ts), [`gui/local-backend/main.ts:38`](../../gui/local-backend/main.ts).

```ts
// http.ts
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};
```

Every response carries `Access-Control-Allow-Origin: *`. There is no Host validation, no Origin allowlist, no CSRF token, no per-instance secret. Any web page the user has open in the same browser can issue cross-origin `fetch()` calls to `http://127.0.0.1:8787` and **read the responses** (because of `*`).

Concrete attacker capabilities from any malicious origin (e.g. an iframe ad, a phishing site the user visits in another tab, a typo-squat domain, etc.):

1. **Identity enumeration & private metadata exfiltration**:
   - `GET /api/v1/identities` — full list of local identity names, fingerprints, key types, attached details (incl. unverified email addresses).
   - `GET /api/v1/context` — discloses `~/.ebp/` path, current identity name, configured server URL.
   - `GET /api/v1/identity/public?name=…` — ExternalIdentity (public keys, all detail proofs) for any local identity.
   - Contacts, hierarchy, mail account list — all readable.
2. **Arbitrary write to `~/Downloads/`**:
   - `POST /api/v1/save-file` accepts `{filename, content}` or `{filename, base64Content}`. Filename validation rejects path separators (good — no traversal) and rejects `.`/`..` exact strings, but **no overwrite check**. Attacker can drop:
     - `~/Downloads/install.sh` to social-engineer execution.
     - `~/Downloads/setup.exe` to be promoted by users who look for "their" install file.
     - Replace any binary the user previously saved in Downloads (e.g. an updated EBP installer the user is about to run).
3. **OAuth-flow takeover**:
   - `POST /api/v1/mail/oauth/start` and `POST /api/v1/mail/oauth/open-browser` from an attacker origin can launch an OAuth flow targeting the user's Gmail/Outlook account against attacker-controlled `oauthState` keys, lifting bearer tokens via subsequent `/poll`.
4. **Drive-by IMAP/SMTP configuration**:
   - `POST /api/v1/mail/account` (and similar) accept attacker-supplied `imapHost`/`smtpHost` etc., which the local backend will then connect to with the user's stored credentials at the next mail fetch.
5. **Sign / decrypt requires a password**:
   - `/api/v1/sign` / `/api/v1/decrypt` require the per-identity password supplied in the request body, so cross-origin signing/decryption requires social-engineering the user to enter their password into a hostile page. Lower likelihood but not impossible (the attacker page can show a perfectly believable "EBP needs your password" prompt).
6. **DNS rebinding**:
   - With default `127.0.0.1` bind and no Host check, an attacker domain whose A record is briefly attacker-IP, then 127.0.0.1, allows the attacker page to bypass even classic same-origin-policy mitigations and access localhost as if it were the attacker origin.

**Impact:** Critical. A user need only visit a malicious page in a tab adjacent to the EBP GUI for an attacker to (a) enumerate the user's identities, contacts, mail accounts, and connected server; (b) drop arbitrary files in Downloads; (c) initiate IMAP/OAuth account takeovers. With minor social engineering this becomes signing-key access.

**PoC:** [`pocs/F-GUI-01-cross-origin-csrf.html`](pocs/F-GUI-01-cross-origin-csrf.html). Will run dynamically in Phase 8.

**CVSS 3.1:** AV:N/AC:H/PR:N/UI:R/S:C/C:H/I:H/A:H — 8.3 High per CVSS calculator. Rated Critical here because of the read-and-write nature of the cross-origin breach combined with the trust placed in the local backend.

**Recommendations** (all of these together — defense in depth):

1. **Bind a per-launch CSRF token.** On startup, generate a 32-byte hex token. Inject it into every page the local backend serves (e.g. `<meta name="ebp-token" content="...">`). Require every state-changing request to carry it as `X-EBP-Token`. Reject otherwise.
2. **Restrict CORS to `null` (file://) and the Tauri webview origin** (`tauri://localhost` on macOS, `https://tauri.localhost` on Windows). Drop `*`. Reject cross-origin requests outright.
3. **Validate Host header**: only accept `Host: 127.0.0.1[:port]` or `localhost[:port]`; reject other hostnames (defeats DNS rebinding).
4. **Set `X-Content-Type-Options: nosniff`** on every response.
5. **Add per-route privilege classes** — e.g. signing/decrypt require an additional confirm-via-OS-dialog (Tauri has `dialog.ask`); save-file requires user confirmation; OAuth start requires existing in-app initiation token.
6. Consider switching to a Unix domain socket on macOS/Linux (no IP exposure at all), or `npipe` on Windows.

### F-GUI-02 — `save-file` overwrites without confirmation (Medium)

**File:** [`gui/local-backend/routes.ts:2799-2825`](../../gui/local-backend/routes.ts).

After filename validation, the handler just calls `Deno.writeFile(filePath, ...)` / `Deno.writeTextFile(filePath, ...)`. No `O_EXCL`, no existence check. Combined with F-GUI-01, an attacker page can overwrite any file in `~/Downloads/` whose name they can guess. Even without F-GUI-01 a buggy or malicious frontend page reachable via the same backend can do the same.

**Recommendation:**
- Refuse if file exists; or rename with a numeric suffix (`foo (1).txt`).
- Use Tauri's `dialog.save` to let the OS pick the directory + name when running under Tauri.
- Outside Tauri, redirect to the `Downloads/<random hex>` subdirectory.

### F-GUI-03 — Wide Deno permissions (Medium)

**File:** [`deno.json`](../../deno.json) `tasks.gui` and `tasks.gui:local-backend`.

```
deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys
```

All five high-impact permissions are unconstrained. `--allow-read=$HOME/.ebp,$HOME/Downloads`, `--allow-write=$HOME/.ebp,$HOME/Downloads`, `--allow-net=127.0.0.1:8787,api.gmail.com,...`, `--allow-run=xdg-open,gio,sensible-browser,open,rundll32,powershell` are all enforceable scopes. Especially `--allow-run` should be a hard allowlist.

### F-GUI-04 — `--allow-run` openers permit `gio open` and `sensible-browser` arbitrary scheme (Low)

**File:** [`gui/local-backend/routes.ts:243-282`](../../gui/local-backend/routes.ts).

URL is validated to start with `https://` or `http://127.0.0.1`. That correctly blocks `javascript:`, `file:`, `vbscript:`, `data:`. Good. Note however that `gio open` will happily open `https://attacker.example/foo` in the user's default browser. Not a vulnerability per se — that is the intended function. Worth flagging that `?url=` is fully attacker-controlled when reached via F-GUI-01: cross-origin can force-open any HTTPS URL in the user's default browser, useful for drive-by phishing redirection.

### F-GUI-05 — `mailparser` and `imapflow` parse attacker-controlled MIME (High, conditional)

**Files:** [`gui/local-backend/mail-imap.ts`](../../gui/local-backend/mail-imap.ts), and `import { simpleParser } from "mailparser"` in [`gui/local-backend/routes.ts:2`](../../gui/local-backend/routes.ts).

The local backend parses arbitrary attacker-controlled MIME via `mailparser` and arbitrary IMAP protocol traffic via `imapflow`. Historical CVE pattern for these libraries:
- mailparser: prototype-pollution-style issues (CVE-2020-7791 territory) and ReDoS in header parsing.
- imapflow: TLS-bypass / parser-confusion in earlier versions.

`package.json` pins `mailparser ^3.9.3` and `imapflow ^1.2.12`. Both are recent. `npm audit` will be run in Phase 6. Conditional severity — depends on the audit outcome; raised here so we follow up.

### F-GUI-06 — `Identity.signMessage` lacks per-action user confirmation (Medium)

**File:** [`gui/local-backend/routes.ts:1540-1597`](../../gui/local-backend/routes.ts).

`POST /api/v1/sign` accepts `{message, password}`. If a malicious page convinces the user to enter their password (via a fake EBP popup), the backend will sign any message. There is no second factor and no out-of-band confirmation of *what is being signed*. A real EBP signing UI would show the message in a Tauri-native confirm dialog.

Combined with F-GUI-01 and a phishing prompt this is a one-click signing-key compromise. Recommendation: require a Tauri-native confirm dialog before signing any message that originates from outside the GUI app's own state.

### F-GUI-07 — `decryptAndVerify` shape passed straight to JSON consumers (Low / cross-reference F-CRYPTO-02)

The encrypt+sign payloads received via `routes.ts` `/api/v1/decrypt` flow through `Identity.decryptAndVerify`. Surreptitious-forwarding (F-CRYPTO-02) means a user reading a re-forwarded encrypted message will see "verified, from Alice" with no UI indication that the original recipient was someone else. The frontend should be updated alongside the F-CRYPTO-02 fix to display "to: <recipient>" from the new envelope and visually highlight when `recipient !== self`.

### F-GUI-08 — `readJson` has no body-size cap (Medium)

**File:** [`gui/local-backend/http.ts:98-104`](../../gui/local-backend/http.ts).

Unlike the public `server/`, the local backend uses `req.json()` directly with no streaming-byte cap. Every endpoint that accepts JSON is therefore willing to buffer arbitrarily large bodies. A hostile cross-origin page (per F-GUI-01) can OOM the local backend by streaming a multi-GB body to any endpoint.

Add a `MAX_BODY_SIZE` enforcement mirroring `server/body.ts`.

### F-GUI-09 — Sensitive paths and home-directory leak in responses (Low)

`GET /api/v1/context` returns `identityDir` and `contactsDir` containing the user's home path. `POST /api/v1/save-file` returns the full disk path of the saved file. Combined with F-GUI-01, a cross-origin attacker learns the user's username and OS layout — fingerprinting / tailored-attack input.

### F-GUI-10 — OAuth state map can be poisoned cross-origin (Medium)

**File:** [`gui/local-backend/routes.ts:133-156`](../../gui/local-backend/routes.ts).

`mailOauthStarts` is a JS Map keyed by a 24-byte random oauthState. A malicious origin (per F-GUI-01) can flood `POST /api/v1/mail/oauth/start` to fill memory and to stage attacker-controlled OAuth redirects. The redirect URI is fixed (`getMailOAuthRedirectUri()` returns a server-controlled URL), so the state map fill is mostly a DoS rather than a token-takeover. Add per-state rate limit and a max-pending count.

### F-GUI-11 — Static-file serving normalizes percent-encoding before traversal check (Low)

**File:** [`gui/local-backend/http.ts:55-86`](../../gui/local-backend/http.ts).

```ts
const decoded = decodeURIComponent(url.pathname);
if (decoded.includes("..") || decoded.includes("\\")) { ... }
```

`decodeURIComponent` normalises `%2e%2e` to `..` BEFORE the check, which is correct. However, double-encoded `%252e%252e` becomes `%2e%2e` after one decode, which does NOT contain `..`. Then `new URL(target, STATIC_ROOT)` re-resolves the percent encoding via `Deno.readFile(fileUrl)`. Whether `Deno.readFile(new URL("./%2e%2e/...", root))` actually escapes the static root is fs-implementation-dependent — `URL` constructor likely normalises the percent-encoded dot-segments.

Hardening: explicitly decode twice and re-check, or call `path.resolve` and `path.relative` to verify the resolved path is under `STATIC_ROOT`.

### F-GUI-12 — Mail-OAuth callback HTML response interpolates server-controlled `err` and `message` strings (Low)

**File:** [`gui/local-backend/routes.ts:170-205`](../../gui/local-backend/routes.ts).

```ts
return new Response(`<!doctype html><html><body><h3>OAuth failed: ${err}</h3></body></html>`, ...);
```

`err` comes from `url.searchParams.get("error")` then through `toSafeString(_, 256)` — which only enforces type and max length, not HTML escaping. Provider-side OAuth errors shouldn't carry HTML, but a hostile redirect URI scenario could land here. Apply HTML escaping for defense-in-depth.

## Static checks

```
$ deno lint gui/local-backend/
Found 0 problems
Checked 9 files
```

(see `tooling-output/phase-04-deno-lint-gui-backend.txt`)

## Hand-off to Phase 5

Phase 5 covers CLI, website verifier, and the Tauri desktop shell. The Tauri shell embeds the local backend as a sidecar — meaning the F-GUI-01 surface is present even in the desktop app unless Tauri's webview confines it. Critical Phase 5 questions:
- Does the Tauri webview disable arbitrary-origin navigation? (`tauri.conf.json` `dangerousRemoteDomainIpcAccess` etc.)
- Is the sidecar binding still `127.0.0.1`?
- Does the website verifier accept a server response without re-verifying client-side, or does it trust whatever the server returns?

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[phase-02-crypto-core]]
- [[phase-03-server]]
