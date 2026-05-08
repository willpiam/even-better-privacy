---
title: "Analysis: Application Complexity Debt (excluding /mobile and /email)"
type: analysis
status: active
last_updated: 2026-04-30
source_count: 0
tags:
  - architecture
  - complexity
  - refactoring
  - tech-debt
---

# Application Complexity Debt

A code- and wiki-grounded review of where the EBP repository (excluding
`mobile/` and `email/`) is more complicated than it needs to be. The
ReadMe already lists "tighten up `core`", "tighten up `gui/local-backend`",
and "Better db interface layer" as known debt items; this page expands
each of those with concrete evidence and adds findings the ReadMe does
not yet capture.

## Top complexity hotspots

### 1. `gui/local-backend/routes.ts` is a 4,795-line single function

`gui/local-backend/routes.ts` (4,795 lines) holds 46+ inline arms of
`if (req.method === ... && url.pathname === ...)` inside one
`handleRequestInternal` function. There are no per-domain handler
modules; sign/verify/encrypt/decrypt/file/mail/oauth/hierarchy/contacts
all branch from the same body.

Compare to `server/main.ts` (252 lines), which routes the same way but
delegates to per-domain modules in `server/handlers/` (identity, verify,
revocation, hierarchy, discovery). The server pattern is the working
template; the GUI backend has not adopted it.

This is the README item `tighten up gui/local-backend`. Concrete
remediation: split `routes.ts` into `gui/local-backend/handlers/{sign,
verify,encrypt,decrypt,file,mail,oauth,hierarchy,contacts}.ts`,
mirroring the `server/handlers/` shape.

Evidence:
- `gui/local-backend/routes.ts` (one function from line 267 onward)
- `server/main.ts` (252 lines, handler-style)
- ReadMe.md "tighten up `gui/local-backend`"

### 2. The desktop app pays for an HTTP loopback layer it does not need

The Tauri shell (`desktop/src-tauri/src/main.rs`) spawns a Deno-compiled
sidecar (`ebp-gui-backend`) that listens on `127.0.0.1:8787`. A
loader page (`desktop/dist/index.html`) polls a health endpoint and
redirects to the sidecar URL. See [[analysis-linux-build]] for the
rationale (Cargo caching of statically-embedded frontend was unreliable
under Tauri 1.x).

The HTTP-loopback architecture is essential for the
browser-served GUI workflow (`deno task gui` → open browser at
`localhost:8787`). It is overkill for the desktop case, where Tauri
natively supports IPC commands and asset bundling. Two consequences
follow:

- The GUI ships its API surface as REST endpoints with body parsing,
  CORS handling, CSRF tokens, rate limiting, and origin validation —
  necessary for the browser flow but pure overhead inside Tauri.
- Every sign/verify/encrypt/decrypt call inside the desktop app pays
  for an HTTP request through localhost rather than a direct function
  call.

Long-term simplification options: keep the HTTP path for the
browser-served GUI but expose the same functions as Tauri commands for
the desktop build, or treat the desktop case as a proper subset of the
backend rather than the same surface.

Evidence:
- `desktop/src-tauri/src/main.rs` (sidecar spawn + loader redirect)
- `desktop/dist/index.html` (67-line loader)
- `gui/local-backend/main.ts`, `gui/local-backend/routes.ts`
- [[component-gui]], [[analysis-linux-build]]

### 3. The DB layer abstracts the connection, not EBP actions

`server/db/index.ts` is 813 lines of inline parameterized SQL with `?`
placeholders. `server/db/postgres.ts` rewrites every `?` to `$1, $2,
...` at query time, and reads come back as positional tuples that have
to be unpacked with long destructuring matches in
`server/db/index.ts`. Both adapters duplicate the full schema as
`CREATE TABLE IF NOT EXISTS ...` blocks, plus 7-10 rounds of `ALTER
TABLE ... ADD COLUMN IF NOT EXISTS` (postgres) and
`try { ALTER TABLE ... } catch { /* column already exists */ }`
(sqlite) calls in lieu of a versioned migration system.

This is the README item `Better db interface layer / abstract on EBP
actions instead of the db connection`. The current shape leaks SQL
into call-sites; a proper repository layer (e.g. `IdentityRepo`,
`DetailRepo`, `RevocationRepo`, `HierarchyRepo`) with backend-specific
implementations would let `sqlite.ts` and `postgres.ts` diverge where
they need to (LIKE escape, JSON columns, returning rows, big-int
handling) instead of papering over differences via `?` rewriting.

Evidence:
- `server/db/index.ts` (813 lines of mixed SQL + result unpacking)
- `server/db/sqlite.ts` (10 try/catch ALTER blocks)
- `server/db/postgres.ts` (parallel ALTER IF NOT EXISTS + `?`→`$N`
  rewriter)
- ReadMe.md "Better db interface layer"

### 4. `core/Identity.ts` is a 1,328-line god class

`Identity` carries 38 methods covering: signing (single, recipient-
bound, multi-recipient), verification (legacy + envelope + recipient-
bound + multi-recipient), encryption + decryption + signed-encrypt
combinations, detail attach + verify, detail revoke, identity
revoke, emergency revocation cert generation, storage format
serialization (`toStorageFormat`/`fromStorageFormat`), JSON
serialization (`toJSON`/`fromJSON`), and key-type dispatch.

The class also contains repeated `switch (signingKeyType)` /
`switch (encryptionKeyType)` blocks (constructor, `fromJSON`,
`summary`, `toStorageFormat`, `fromStorageFormat`, recipient-bound
verification helpers). A small key-type registry would centralize that
dispatch.

This is the README item `tighten up core`. Plausible decomposition:

- `core/IdentityIO.ts` — storage, JSON, summary
- `core/IdentitySign.ts` — signing variants
- `core/IdentityEncrypt.ts` — encryption + signed-encrypt
- `core/IdentityVerify.ts` — verification variants
- `core/IdentityDetails.ts` — attach/verify/revoke detail flows
- `core/IdentityRevocation.ts` — identity revoke + emergency cert
- `core/KeyTypeRegistry.ts` — single dispatch table for signing /
  encryption key types

Evidence:
- `core/Identity.ts` (1,328 lines, 38 methods)
- ReadMe.md "tighten up `core`"

### 5. Three+ concurrent envelope formats inside `core/MessageHash.ts`

After the F-CRYPTO-03 domain-separation fix
([[analysis-top-open-security-issues]]), `core/MessageHash.ts` exports:

- `ebp::messagehash::{hash}::{salt}` — legacy, no domain separation,
  retained for backward compatibility (`buildLegacyMessageHashEnvelopeFromHash`).
- `ebp::message::v1::`, `ebp::detail-proof::v1::`,
  `ebp::revocation::v1::`, `ebp::hierarchy::v1::` — new purpose-
  prefixed envelopes.
- `ebp::messagehash::v2::{recipientFp}::{hash}::{salt}` — recipient-
  bound (F-CRYPTO-02 fix).
- `ebp::messagehash::v3::{canonicalHash}::{salt}` — multi-recipient.

Some of this is justified domain separation. Some is genuine cruft —
the `messagehash` namespace and the `message` namespace coexist, and
both `buildMessageHashEnvelopeFromHash` and
`buildPurposeHashEnvelopeFromHash("message", ...)` are exported and
do the same thing for the message purpose. The `v2`/`v3` family
should likely move under the new `ebp::message-recipient-bound::v1::`
naming so the version axes (purpose, recipient binding) are
orthogonal rather than entangled with the legacy `messagehash`
prefix.

Evidence:
- `core/MessageHash.ts`
- [[analysis-top-open-security-issues]] (F-CRYPTO-03 history)

### 6. `core/CanonicalJson.ts` is a 5-line shim that adds no value

`core/CanonicalJson.ts` re-exports `stableStringify` from
`core/StateHash.ts` under a different name (`canonicalJsonStringify`).
It is a single five-line file. Either inline `stableStringify` at the
two or three call-sites that currently import the shim, or move the
canonical-JSON helpers into their own module and stop re-exporting
from `StateHash.ts`. As-is it is gratuitous indirection.

Evidence:
- `core/CanonicalJson.ts`
- `core/StateHash.ts`

### 7. Two parallel verifier implementations

`server/handlers/verify.ts` (~321 lines, plus
`POST /api/v1/verify-signature` route wiring in `server/main.ts`) and
`website/verify.js` + `website/crypto.js` both parse the same
payload shapes (`ebp-signed-message`, `ebp-signature`,
`ebp-signed-file`) and both perform cryptographic verification.
[[component-website]] now treats the static verifier as authoritative
(the F-WEB-01 fix) and the server's verify endpoint as advisory. The
server verifier is therefore code that is exercised but not trusted —
a shape that invites drift.

Some duplication is unavoidable because the static site cannot import
Deno-flavored `core/`. The avoidable part is the server's payload-
shape parsing and key-type dispatch, which currently re-implements
much of what `core/Identity.ts::VerifySignature` already does. Could
collapse to a single thin server endpoint that delegates straight into
`core/`, or retire the server verifier entirely now that the static
client is authoritative.

Evidence:
- `server/handlers/verify.ts`
- `website/crypto.js`, `website/verify.js`
- [[component-website]] §"Signature Verifier"
- [[analysis-top-open-security-issues]] (F-WEB-01 history)

### 8. CLI flag declarations are repeated four times

`cli/main.ts` declares each flag in `STRING_FLAGS`, `BOOLEAN_FLAGS`,
`FLAG_ALIASES`, and `KNOWN_FLAGS` independently, plus a hand-rolled
`findUnknownFlags` that re-implements part of `parseArgs`'s job. A
small `flags` table keyed by flag name with `{ kind, alias }` would
collapse all four lists into one source of truth and let the parser
itself reject unknown flags.

Evidence:
- `cli/main.ts` lines 41-100

### 9. `gui/app.js` does 49 imperative `addEventListener` wirings

`gui/app.js` (1,241 lines) is a flat bootstrap that imports from nine
sibling modules and wires up 49 event listeners by hand. It also
contains a manual circular-dependency workaround:
`setMailLoaders({ ... })` injects late-bound mail loaders into
`render.js`. This shape resists incremental cleanup. A modest
declarative event table or per-page module that owns its own bindings
would localize the wiring and remove the late-bound injection.

Evidence:
- `gui/app.js` (1,241 lines, `addEventListener` count = 49)

### 10. Public key server carries mail-OAuth proxy code

`server/mail-oauth.ts` (190 lines) and `server/handlers` for
`/api/v1/mail/oauth/exchange` and `/api/v1/mail/oauth/refresh` exist
because Gmail/Outlook OAuth client secrets cannot live on user
devices. This is documented in the ReadMe ("only provided to key
server (playing double duty by also handling oauth)").

The coupling is necessary in the current design but not architectural
(the discovery server has no other reason to know about mail
providers). If mail OAuth ever justifies its own service, splitting
it out of the discovery/key server would simplify both surfaces.

Evidence:
- `server/mail-oauth.ts`
- `server/main.ts` lines 231-236
- ReadMe.md "Native Email Via OAuth"

## Lower-priority simplifications (still real)

- `server/db/sqlite.ts` carries 10 `try { ALTER TABLE ... } catch`
  blocks instead of a migration-version table. A single
  `schema_migrations` table + numbered migrations would fix this.
- `gui/local-backend/routes.ts` re-implements small payload-parsing
  helpers (`parseMailAttachmentInputs`, `parseMailRecipientsInput`,
  `hashPayload`, `sourceByteLength`, `clientRateLimitKey`) that
  could move to `gui/local-backend/http.ts`.
- The CLI command dispatch in `cli/main.ts` is a clean switch over
  ~22 cases. Mild repetition only; not a priority.

## What is NOT extra complexity

A few patterns look heavy but are load-bearing and should not be
"simplified" away:

- **Dual-key Identity** ([[identity-model]]): always pairing a
  signing key with a KEM key is structural to EBP and not an
  abstraction tax.
- **Independent `website/crypto.js`**: the static site cannot share
  Deno code; reimplementing verification in browser-only JS is
  required, not duplication.
- **CLI vs GUI parallelism**: by design, two interfaces over the same
  `~/.ebp/` data ([[component-cli]], [[component-gui]]).
- **Domain-separated envelopes**: the per-purpose envelopes in
  `core/MessageHash.ts` exist as a security fix (F-CRYPTO-03) and
  are not optional. Only the *coexistence with* the legacy
  `messagehash` namespace is cleanup-able.

## Suggested ordering

If the project wants to retire complexity debt incrementally, an
order roughly by leverage:

1. Split `gui/local-backend/routes.ts` into per-domain handlers
   (item 1). High leverage, no behavior change, immediately makes
   the file navigable and review-able.
2. Repository-style DB layer (item 3). Unblocks alternative
   backends and removes the `?`→`$N` rewriting + tuple unpacking
   tax from every query.
3. Decompose `core/Identity.ts` (item 4). Cleanest after item 1,
   since the GUI handlers will then be calling smaller, more
   focused core APIs.
4. Collapse the server verifier (item 7) and retire
   `core/CanonicalJson.ts` (item 6). Both are small and safe.
5. Retire the legacy `messagehash` envelope (item 5). Requires a
   protocol-version step; do alongside the next protocol bump.

## Related Pages

- [[overview]]
- [[component-cli]]
- [[component-gui]]
- [[component-server]]
- [[component-website]]
- [[identity-model]]
- [[analysis-linux-build]]
- [[analysis-top-open-security-issues]]

## Sources

- `ReadMe.md` (Upcoming Features list — `tighten up core`,
  `tighten up gui/local-backend`, `Better db interface layer`)
- `gui/local-backend/routes.ts`
- `server/main.ts`, `server/handlers/`, `server/db/`,
  `server/mail-oauth.ts`
- `core/Identity.ts`, `core/MessageHash.ts`,
  `core/CanonicalJson.ts`, `core/StateHash.ts`
- `cli/main.ts`
- `gui/app.js`
- `desktop/src-tauri/src/main.rs`, `desktop/dist/index.html`
- `website/crypto.js`, `website/verify.js`
