---
title: "Phase 5 — CLI, website verifier, Tauri shell"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-5
  - cli
  - website
  - tauri
---

# Phase 5 — CLI, website verifier, Tauri shell

Part of the April 2026 [[README|EBP Security Audit]]. Covers [`cli/`](../../cli) (~1.5k LOC), [`website/`](../../website), and [`desktop/src-tauri/`](../../desktop/src-tauri).

## Findings

### F-CLI-01 — Password prompt does not disable terminal echo (High)

**File:** [`cli/utils.ts:121-127`](../../cli/utils.ts), `readPassword`.

```ts
export async function readPassword(prompt: string): Promise<string> {
  const buf = new Uint8Array(1024);
  await Deno.stdout.write(new TextEncoder().encode(prompt));
  const n = await Deno.stdin.read(buf);
  ...
}
```

The function does NOT put the terminal in raw / no-echo mode (no `Deno.stdin.setRaw(true)`, no `tty.makeRaw`, no `--no-echo` POSIX termios manipulation). The user's password is echoed on the screen as they type, ends up in tmux/screen scrollback, gets recorded by terminal emulators that store history, and is visible to anyone shoulder-surfing.

**Impact:** Persistent local exposure of the identity password. Combined with `~/.ebp/<name>.identity.json` being readable by any process running as the user (per F-STORAGE-* in Phase 7), this means anyone with read access to either the disk or the terminal session/scrollback can decrypt the identity.

**Recommendation:** wrap the read with `Deno.stdin.setRaw(true, { cbreak: true })`, manually consume bytes until `\n`, suppress echo, restore TTY state in a `finally`. Also explicitly warn that `--password` flag exposes the password in shell history.

**CVSS 3.1:** AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:N — 6.0 Medium per CVSS, raised to High here because the password unlocks the long-term private signing/encryption key.

### F-CLI-02 — `--password` flag accepts shell-history-leaked secret (Medium)

**File:** [`cli/main.ts:178`](../../cli/main.ts).

`--password` is documented in `--help` with a warning ("avoid - will be visible in shell history"). However, the CLI also accepts it without warning at use site. Stronger mitigations:
- Print a one-line warning at runtime when `--password` is used.
- Prefer reading from `EBP_PASSWORD` env var or `--password-file` reference instead.

### F-CLI-03 — Persisted server URL accepted from user state without scheme check (Medium)

**File:** [`cli/utils.ts:158-166`](../../cli/utils.ts), `ensureServer`; [`cli/commands/server.ts:23`](../../cli/commands/server.ts).

`ctx.server` comes from `~/.ebp/state.json` and is used directly via `apiUrl(server, …)`. There is no enforcement that `server` is HTTPS. A user who pastes `http://attacker/` once (or whose state.json is tampered with) will silently fetch every subsequent identity / publish / fetch over plaintext HTTP and trust attacker-supplied responses.

For `cmdPublishIdentity` (server.ts:48-58), if the server returns attacker-controlled `signingKey` for `/api/v1/identity/<fp>`, the CLI just refuses to publish — defensive behavior is good, but verifying signers later (via `/api/v1/verify-signature`) trusts the server response (`body.verified`). A hostile or compromised server can lie.

**Recommendation:**
- Reject `http://` server URLs unless an explicit `--insecure` flag is set.
- Pin a known set of root domains by default.
- Always do client-side signature verification rather than trusting the server's `verified: true`.

### F-CLI-04 — `cmdEncryptFile` uses `safeFileName` which strips control chars but does not enforce length (Low)

**File:** [`cli/commands/files.ts:36`](../../cli/commands/files.ts), `cli/utils.ts:186-188`.

`safeFileName` removes control characters and `..` patterns but does not cap length. A very long filename (e.g. ~10 MB string) will end up in the JSON payload and storage. Practical impact bounded but worth a length cap (e.g. 255 bytes per filesystem norms).

### F-CLI-05 — `parseArgs` accepts unknown flags silently (Informational)

`parseArgs` is configured with explicit `string` and `boolean` lists, but unknown flags are silently dropped. Typo'd `--reciipient` will not raise an error — the encrypt operation will then fail with "Recipient required". Add `unknown: (key) => { console.error(\`Unknown flag: ${key}\`); Deno.exit(1); }`.

### F-CLI-06 — `Identity.fromStorageFormat` failure message conflates wrong-password and corruption (Low)

**File:** [`cli/utils.ts:204-210`](../../cli/utils.ts).

```ts
} catch {
  console.error("Failed to decrypt identity. Wrong password?");
  Deno.exit(1);
}
```

A malformed or downgraded identity file presents the same error as a wrong password, leading the user to retry passwords against a corrupt file. Differentiate via inspecting the storage format version first.

### F-WEB-01 — Verifier trusts server `verified` field; no client-side verification (Medium)

**Files:** [`website/verify.html`](../../website/verify.html), [`website/verify.js:185-208`](../../website/verify.js).

The verifier submits the signature payload to the configured server (`https://ebp-cqyo.onrender.com` by default) and renders the server's `body.verified` boolean as the result. There is no client-side signature verification using the public identity blob the user pastes.

Consequences:
- A hostile server (or a hostile user-pasted server URL) can lie: return `verified: true` for invalid signatures.
- The user's mental model is "the server is just a directory; verification is cryptographic". Reality: trust is placed in the server's response.

**Recommendation:** import `core/Dilithium.ts` / `core/Sphincs.ts` into the verifier (transpile to a browser-friendly bundle) and perform local verification against the supplied or fetched public key. Use the server only to fetch the published identity, not to verify the signature.

### F-WEB-02 — `serverUrlInput` accepts `http://` without warning (Medium)

**File:** [`website/verify.js:127`](../../website/verify.js).

User can override the verifier's server URL with any string. No HTTPS enforcement; no allowlist; no warning when changed from default. Combined with F-WEB-01, a malicious page that links to `verify.html?serverUrl=http://attacker/` (the page does not actually parse that query parameter, but the user can be social-engineered to paste a hostile URL) yields full result-tampering.

Recommendation: prefix-warn when scheme is not `https://` and gate behind a confirm dialog.

### F-WEB-03 — No CSP set on `verify.html` (Medium)

The page imports `./verify.js` and `./styles.css` from same-origin and pulls images from `raw.githubusercontent.com`. No `Content-Security-Policy` header or meta tag. A future server-side XSS that injects content into the verifier page (e.g. via `Reverse-XSS` from F-SERVER-01 if same origin) gains full DOM access.

Recommendation: ship a strict CSP via `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https://raw.githubusercontent.com data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src https://ebp-cqyo.onrender.com https://*.onrender.com">`.

### F-WEB-04 — `JSON.parse` on attacker-pasted content (Low)

**Files:** [`website/verify.js:22-26`](../../website/verify.js).

`tryParseJson` calls `JSON.parse(text)` on user-pasted strings. JS `JSON.parse` does NOT honour `__proto__` for prototype pollution (it sets it as an own property), so this is safe in modern V8/SpiderMonkey. Mention here as a hardening observation.

### F-TAURI-01 — `allowlist.shell.open=true` with no scope (High)

**File:** [`desktop/src-tauri/tauri.conf.json:13-17`](../../desktop/src-tauri/tauri.conf.json).

```json
"allowlist": { "shell": { "open": true } }
```

In Tauri 1.x, this exposes `window.__TAURI__.shell.open(url)` to ANY page rendered in the webview, with no URL scope/allowlist. The webview's `devPath: http://127.0.0.1:8787/` means whatever the local backend serves can call `shell.open("file:///etc/passwd")`, `shell.open("vscode://...")`, custom-scheme URI handlers, etc.

Combined with F-GUI-01, a cross-origin attacker that lands JS into the local backend's served page surface (or any page the webview navigates to) can launch arbitrary OS scheme handlers.

**Recommendation:** either set `"shell": { "open": "^https?://" }` (regex scope: only http/https), or remove `shell.open` from allowlist and call out via a custom Tauri command that allowlists exact URLs.

### F-TAURI-02 — No CSP on Tauri webview (High)

**File:** [`desktop/src-tauri/tauri.conf.json`](../../desktop/src-tauri/tauri.conf.json).

There is no `tauri.security.csp` field. Tauri ships a permissive default. Combined with the local backend serving the entire frontend (and F-GUI-01 exposing the local backend cross-origin), the webview has no defense-in-depth against XSS chains.

**Recommendation:** add e.g.
```json
"security": {
  "csp": "default-src 'self' http://127.0.0.1:8787 'unsafe-inline'; script-src 'self' http://127.0.0.1:8787; img-src 'self' data: blob:; connect-src http://127.0.0.1:8787; frame-src 'self';"
}
```

### F-TAURI-03 — Sidecar resolution falls back to PATH-like locations (Medium)

**File:** [`desktop/src-tauri/src/main.rs:103-222`](../../desktop/src-tauri/src/main.rs), `resolve_sidecar`.

The Rust shell scans many directories (`resource_dir`, `current_exe().parent()`, `APPDIR/usr/bin`, `Contents/Resources`) for `bin/ebp-gui-backend`. If an attacker can drop a same-named binary in any of those locations (e.g. `./bin/ebp-gui-backend` next to the Tauri exe), the Tauri shell will execute it as the user.

For AppImage / Mac .app distributions this is constrained to system-controlled directories. For the developer-mode build, the binary is sourced from `desktop/src-tauri/bin/`. Risk is bounded but worth tightening: refuse to execute if the resolved sidecar is not under the resource dir / app bundle.

### F-TAURI-04 — `bundle.targets: "appimage"` only (Informational)

The Tauri config builds AppImage only. The macOS / Windows builds are produced by separate shell scripts (Phase 6). This means signing posture and notarisation are NOT enforced via Tauri's build pipeline — they are entirely shell-script-driven. Document the gap.

### F-TAURI-05 — Sidecar log file in app log dir written without permission tightening (Low)

**File:** [`desktop/src-tauri/src/main.rs:86-95`](../../desktop/src-tauri/src/main.rs), `init_sidecar_log`.

`OpenOptions::new().create(true).append(true).open(log_path)` uses default permissions (typically 0644 on Linux). Sidecar stdout/stderr (which can contain mail content snippets, stack traces with file paths, OAuth flow detail) is world-readable on multi-user systems. Set 0600 on creation.

## Hand-off to Phase 6

Phase 6 covers supply-chain — `mailparser`, `imapflow`, `nodemailer`, Tauri Rust crates, the Dockerfile, build scripts, and a secret scan. Phase 5 raised F-GUI-05's contingent severity on the mailparser audit; that resolves in Phase 6.

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[phase-04-gui]]
