---
title: "Phase 3 — Server review"
type: analysis
status: completed
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-3
  - server
---

# Phase 3 — Server review

Part of the April 2026 [[README|EBP Security Audit]]. Covers [`server/`](../../server) (~3.0k LOC, public-internet-facing).

## Summary

The server has good cryptographic hygiene (every mutation requires a signed proof verified against the on-disk identity public key, every SQL query is parameterized with `?` placeholders, body size is enforced by both Content-Length AND streaming byte count, and an HTTP rate limiter is in place). But it has at least one publicly-exploitable High-severity issue (reflected XSS on the email-verification GET page) and one publicly-exploitable High-severity authorization bypass (anyone can reject anyone else's pending hierarchy proposal). It also has a class of operational misconfigurations (CORS `*` default, X-Forwarded-For trust without proxy gate, root-user Docker container) that would weaken any real deployment.

## What is correct

- All SQL is parameterized with `?` placeholders. Postgres adapter rewrites `?` → `$N` safely. No string concat of user input into SQL.
- Body size limit (`MAX_BODY_SIZE = 512 KB`) enforced via Content-Length header AND while reading the stream — strong defence against malicious large bodies and chunked-encoding tricks.
- Per-field length limits documented in [`server/body.ts`](../../server/body.ts) `LIMITS`.
- bech32 fingerprint validation (`isValidFingerprintBech32`) on every fingerprint input.
- Detail-proof, revocation-cert, and hierarchy-cert verification routed through cryptographic helpers in `core/`. No re-implementation of signature verification at the server layer.
- State-transition signatures use `fromState → toState` chaining to prevent replay of stale state.
- Email verification tokens are 32 bytes from `crypto.getRandomValues`, hashed before storage by default (`EMAIL_VERIFICATION_STORE_PLAINTEXT=false`), 24-hour TTL.
- Rate limiter has per-endpoint configuration with sensible windows.
- Identity-key immutability: server rejects updates that would change `signing_key`/`encryption_key` for an existing fingerprint.
- Hierarchy validation reuses the cycle-checking `validateHierarchy` from core.
- OAuth proxy keeps Gmail/Outlook client_secret server-side; client never sees it.

## Findings

### F-SERVER-01 — Reflected XSS in `/api/v1/verify-email` (High)

**File:** [`server/verify-email.ts:95-120`](../../server/verify-email.ts), `renderVerifyEmailPage`.

```ts
return `<!doctype html>
...
    <input type="hidden" name="token" value="${options.token}">
...`;
```

The `token` query parameter is reflected into a hidden input attribute value WITHOUT HTML-escaping. `validateStringLength` only enforces length / type, not content. An attacker who tricks any user into clicking
`https://<server>/api/v1/verify-email?token="><script>alert(document.domain)</script>`
gets script execution in the server's origin.

**Impact:** Universal XSS on the EBP server origin. Server origin is what the website verifier (`website/verify.html`) talks to, so an XSS here can rewrite signature-verification results visible to that flow, perform phishing under the trusted server hostname, or read/modify any other content rendered from the same origin.

**PoC:** [`pocs/F-SERVER-01-verify-email-xss.sh`](pocs/F-SERVER-01-verify-email-xss.sh). Will verify dynamically in Phase 8.

**CVSS 3.1:** AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N — 6.1 Medium per CVSS calculator, but rated High here because the server origin is trusted by the verifier and any other future server-origin tooling.

**Fix:**
```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// then
<input type="hidden" name="token" value="${escapeHtml(options.token ?? "")}">
```
Apply the same escaping to `options.title` and `options.message`. Add a strict CSP (`Content-Security-Policy: default-src 'none'; form-action 'self'`) on the HTML response.

### F-SERVER-02 — Unauthenticated deletion of pending hierarchy proposals (High)

**File:** [`server/handlers/hierarchy.ts:158-187`](../../server/handlers/hierarchy.ts), `handlePostHierarchyReject`.

The endpoint accepts `{proposalId, fingerprint}` and deletes the proposal if `fingerprint` matches the proposal's master or child. There is no signature proving the caller controls the supplied fingerprint. Any unauthenticated internet caller can delete any pending hierarchy proposal whose `proposalId` they know — and IDs are sequential `BIGSERIAL`/`AUTOINCREMENT`, so they are easy to enumerate.

**Impact:**
- Denial of service against the hierarchy enrollment workflow (attacker continuously deletes incoming proposals before the legitimate counter-party can accept them).
- Combined with rate limiting, the attacker only needs to spread requests across IPs / hours.
- Repudiation: the legitimate party never sees the proposal at all.

**PoC:** [`pocs/F-SERVER-02-hierarchy-reject-dos.sh`](pocs/F-SERVER-02-hierarchy-reject-dos.sh). Will verify dynamically in Phase 8.

**CVSS 3.1:** AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H — 9.1 Critical per CVSS calculator. Rated High here only because the affected feature is in early use; if hierarchy becomes a key feature the rating moves to Critical.

**Fix:** Require a signed reject token. Reuse the propose envelope (`HIERARCHY_CERTIFICATE_PREFIX::reject::masterFp::childFp::proposalId::salt`), have the rejecter sign it with their identity key, and verify against the on-server identity record before deleting.

### F-SERVER-03 — `getClientIp` blindly trusts `X-Forwarded-For` (High)

**File:** [`server/rate-limit.ts:78-82`](../../server/rate-limit.ts).

```ts
return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "unknown";
```

Any internet caller can spoof `X-Forwarded-For` and rotate the value to bypass per-IP rate limits. Render terminates TLS at its proxy and overrides this header before forwarding, so the production deployment is protected by the reverse proxy — but anyone deploying behind a different proxy, no proxy, or running tests / tunnels exposes themselves to unbounded rate-limit bypass and trivially poisoned `ip` field in logs (log injection / log forgery).

**Impact:** Rate-limit bypass on every endpoint (most importantly `/api/v1/verify-email/request`, `/api/v1/identity`, `/api/v1/revoke`). Bulk identity creation / spam emails.

**Fix:**
1. Add a `TRUST_PROXY` env: when false, ignore `X-Forwarded-For` entirely and fall back to socket peer (`req.headers.get("host")` is not enough; Deno `serve` provides remote address via the `info` callback).
2. Even when `TRUST_PROXY=true`, use the right index of the X-Forwarded-For chain (e.g. take the rightmost trusted hop).

### F-SERVER-04 — Default CORS is `*`, no Host validation (Medium)

**File:** [`server/cors.ts:5`](../../server/cors.ts), [`server/main.ts:103-124`](../../server/main.ts).

`ALLOWED_ORIGINS` defaults to `"*"`. `Access-Control-Allow-Origin: *` is then sent on all responses. Browser POST/GET from any origin can reach the API. Combined with no `Access-Control-Allow-Credentials` (good — browsers won't send cookies), state mutations are not exposed to classic CSRF (the server requires cryptographic signatures from the on-disk identity, not cookie auth).

Still, `*` lets every web property scrape the API freely (including identities/search) and amplifies abuse vectors for the OAuth proxy.

**Fix:** ship with a non-`*` default tied to the canonical website + verifier hostnames, document that operators must override.

### F-SERVER-05 — Container runs as root (High)

**File:** [`Dockerfile`](../../Dockerfile).

```
FROM denoland/deno:2.6.6
...
CMD ["run", ...]
```

No `USER` directive. The base image runs as `root` by default. Any RCE / file-write bug in the server gives the attacker UID 0 inside the container — and combined with kernel CVEs or container-escape bugs, increases blast radius. Best practice is `USER deno` (a non-root user the base image already provides).

### F-SERVER-06 — SQLite `PRAGMA foreign_keys` not set (Medium)

**File:** [`server/db/sqlite.ts`](../../server/db/sqlite.ts).

SQLite ships with FK enforcement OFF by default. Without `PRAGMA foreign_keys = ON;` the FK constraints declared in the schema are advisory only. Orphan rows (e.g. a `details` row without an `identities` parent) become reachable via injected DB writes. Add the pragma at adapter init.

### F-SERVER-07 — Search uses `LIKE %query%` against attacker-controlled wildcards (Medium)

**Files:** [`server/handlers/discovery.ts:147`](../../server/handlers/discovery.ts), [`server/db/index.ts:528`](../../server/db/index.ts).

`like = "%" + query.toLowerCase() + "%"`. Query length capped at 256 by `LIMITS.searchQuery`. Attacker-controlled `%` and `_` characters are passed through, so a query like `%a%a%a%a%...` (250 chars) yields a worst-case full-table scan with combinatorial backtracking on each row — particularly slow on Postgres without indexes.

**Fix:** escape `%`, `_`, and `\` before substituting into the LIKE pattern, or switch to a tsvector / FTS index.

### F-SERVER-08 — Identity-existence enumeration via registration (Medium)

**File:** [`server/handlers/identity.ts:114-171`](../../server/handlers/identity.ts).

`POST /api/v1/identity` returns `{fingerprint}` immediately if the identity already exists with matching keys, and a different error if keys mismatch. An attacker can probe arbitrary fingerprints (via known-key bulk replay) to enumerate which identities are registered. Same is exposed via `GET /api/v1/identity/:fingerprint` (404 vs 200), which is generally expected for a discovery server but is the canonical leak surface.

This is mostly informational; a key-discovery server is intentionally enumerable. Worth noting for privacy-conscious operators who might want to gate the search/enumerate endpoints.

### F-SERVER-09 — Verification token in URL (Medium)

**File:** [`server/verify-email.ts:298`](../../server/handlers/identity.ts), [`server/verify-email.ts:191`](../../server/verify-email.ts).

Verification link is `GET /api/v1/verify-email?token=...`. Tokens in URLs leak via:
- HTTP access logs (every server logs query strings).
- `Referer` header to any link the user clicks from the verify page (currently empty page, but future links could leak).
- Browser history.

Mitigation: use POST + form on a thin landing page (already partially done — but the GET endpoint does immediately render the form, so the token is at-rest in browser history regardless). Better: use a one-time short token in URL that maps server-side to the long token.

### F-SERVER-10 — `toHex(...).toLowerCase()` lookups not constant-time (Low)

**File:** [`server/db/index.ts:153-182`](../../server/db/index.ts).

Email-verification token comparison happens at SQL `=` level. SQLite/Postgres `=` on text is not guaranteed constant-time. SHA-256 hashing the candidate before lookup mitigates timing attacks (since `verification_token_hash` lookup is the primary path). The fallback `OR verification_token = ?` only fires when `EMAIL_VERIFICATION_STORE_PLAINTEXT=true`, in which case timing attacks become a small concern. Recommend removing the plaintext path entirely.

### F-SERVER-11 — Unused `signingKey` re-derivation hint (Informational)

**File:** [`server/handlers/identity.ts:87`](../../server/handlers/identity.ts).

`computeSigningRawFingerprint(signingKeyType, signingKey)` is called only for its side effect of throwing on invalid keys. The leading `_type` parameter in the underlying core function is unused, and the helper exists only to surface a parse error. A linter-noise-grade observation but indicates the intent is to validate; an explicit `validatePostQuantumKey` helper that checks the byte length is more reliable.

### F-SERVER-12 — Inherits F-CRYPTO-01, F-CRYPTO-02, F-CRYPTO-03, F-CRYPTO-05 (cross-reference)

Server cannot mitigate cryptographic-core flaws unilaterally; see Phase 2 for fixes. The server-side revocation handler (`server/handlers/revocation.ts:72-78`) does have a special-case for emergency nonce-0:
```ts
if (record.nonce === 0 && type === "identity") {
  if (await hasRevocationWithNonce(db, fingerprint, 0)) {
    return json({ error: "emergency revocation certificate already used" }, 400);
  }
} else if (record.nonce <= maxNonce) { ... }
```
This special-case fixes one half of F-CRYPTO-01 — an emergency identity revocation can use nonce-0 even if regular revocations exist with nonces > 0. **However**, if a regular DETAIL revocation has used nonce 0 first (which is the common case the user is exposed to per F-CRYPTO-01), the `hasRevocationWithNonce(_, 0)` check returns true and the emergency cert is rejected. So the server-side mitigation only works if the emergency cert is the very first revocation event (or all prior revocations had nonce ≠ 0). The Phase 2 finding stands; the server-side carve-out is a partial mitigation, not a cure.

## Static checks

```
$ deno lint server/
Found 0 problems
Checked 22 files
```
(see `tooling-output/phase-03-deno-lint.txt`)

## Tests

The server tests require docker-postgres for the full suite. Crypto-only and route-only unit tests pass. Will exercise dynamically in Phase 8.

## Hand-off to Phase 4

Phase 4 covers the GUI local backend (`gui/local-backend/`, ~2.8k LOC of routes alone), which runs as the user with `--allow-read --allow-write --allow-run --allow-sys` and listens on localhost. F-SERVER-04 (CORS `*`) does NOT apply there — the local backend has different CORS posture. Critical Phase 4 questions:
- Is the local backend bound to `127.0.0.1` only, or `0.0.0.0`?
- Does it validate `Host:` to defeat DNS rebinding?
- Does it require any local-origin token / authentication?
- Does `/api/v1/save-file` permit path traversal?

## Related Pages

- [[README]]
- [[threat-model]]
- [[findings]]
- [[phase-02-crypto-core]]
