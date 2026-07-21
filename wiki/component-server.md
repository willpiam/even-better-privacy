---
title: "EBP Server Component"
type: component
status: active
last_updated: 2026-05-17
source_count: 7
tags:
  - component
  - server
  - api
  - deno
---

# Server Component

The server (`server/main.ts`) is the publish/discovery layer for public identities, details, and revocation state. It is a Deno HTTP server that stores data in SQLite or PostgreSQL. Route handlers are organized into `server/handlers/` (identity, verify, revocation, hierarchy, discovery) with shared infrastructure in `server/cors.ts`, `server/rate-limit.ts`, `server/body.ts`, `server/response.ts`, `server/mail-oauth.ts`, and `server/verify-email.ts`.

## API Endpoints

### Identity

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/identity` | Register or update an identity (requires state signature) |
| `GET` | `/api/v1/identity/:fingerprint` | Fetch a full identity with details, revocation status |
| `GET` | `/api/v1/identities` | List identities (paginated, `?page=N&limit=N`) |
| `GET` | `/api/v1/identities/search` | Search by name, email, or fingerprint (`?query=...`) |

### Details

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/detail` | Attach a detail with signed proof |
| `POST` | `/api/v1/verify-email/request` | Request email verification for an email detail |
| `GET/POST` | `/api/v1/verify-email` | Email verification confirmation (browser + API) |

Verify-email endorses the cleartext `email` detail path only today. Opaque/`opaque::email` endorsement is not implemented; see [[analysis-opaque-detail-endorsement]].

**Detail uniqueness:** The server enforces one active value per detail path. `POST /api/v1/detail` returns **409 Conflict** if an unrevoked detail already exists at the given path. To update a detail, the old value must be revoked first (via `POST /api/v1/revoke`), after which the server accepts a new value at that path. See [[identity-model#Updating a Detail]].

### Revocation

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/revoke` | Submit a signed revocation certificate |
| `GET` | `/api/v1/revocations/:fingerprint` | Get full revocation history |

### Hierarchy

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/hierarchy` | Submit a hierarchy certificate |
| `POST` | `/api/v1/hierarchy/propose` | Propose a hierarchy relationship |
| `POST` | `/api/v1/hierarchy/accept` | Accept a pending hierarchy proposal |
| `POST` | `/api/v1/hierarchy/reject` | Reject a pending hierarchy proposal |
| `GET` | `/api/v1/hierarchy/:fingerprint` | Get hierarchy tree for an identity |
| `GET` | `/api/v1/hierarchy/pending/:fingerprint` | Get pending proposals |

### Signature Verification

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/verify-signature` | Verify a signature against a published or provided identity |

### OAuth Proxy

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/mail/oauth/exchange` | Exchange OAuth code for tokens (Gmail, Outlook) |
| `POST` | `/api/v1/mail/oauth/refresh` | Refresh an OAuth access token |

Gmail uses Google's **web server** authorization-code flow: the GUI completes the browser redirect; this server exchanges the code at `https://oauth2.googleapis.com/token` with the registered `redirect_uri` and keeps the **client secret** in `MAIL_OAUTH_GMAIL_*` env vars (`server/mail-oauth.ts`). See [[source-google-oauth2-web-server]] for Google's flow, redirect-uri rules, offline refresh tokens, and revocation endpoints.

Google Cloud OAuth clients that request **sensitive or restricted** Gmail (or other Google) scopes without completed [OAuth app verification](https://support.google.com/cloud/answer/9110914) are treated as **unverified**: users may see an extra “unverified app” step, Security Checkup warnings, or stricter sign-in behavior, and Google applies a **100 new-user cap** (after the unverified screen appears) until verification succeeds. Requested scopes must match the OAuth consent screen configuration. See [[source-google-cloud-unverified-apps]] for a clipped summary of Google's documentation.

**Cross-Account Protection (RISC):** Google recommends subscribing to signed security-event JWTs when users sign in with Google (session/token revocation, account disabled, etc.). EBP does not document a RISC receiver today; see [[source-google-cross-account-protection-risc]] for setup and event-response guidance.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/health` | Health check with protocol and component versions |

## Security Features

- **State signatures:** identity registration and updates require a signed state transition (`fromState → toState`), verified by the server.
- **Proof verification:** details must include a signed proof that the server validates before storing.
- **Revocation nonce validation:** the server enforces monotonically increasing nonces and rejects replays.
- **Rate limiting:** per-IP, per-endpoint rate limits (configurable, disableable for tests).
- **Request size limits:** 512 KB max body size, per-field length limits.
- **CORS:** configurable allowed origins.
- **HSTS:** optional Strict-Transport-Security headers.
- **Fingerprint validation:** all fingerprints are validated as proper bech32 before use.

The server exposes HTTP URLs and receives URI paths/query strings through the HTTP stack. [[source-rfc-3986]] is the generic syntax reference for URI parsing and percent-encoding; server-side security checks should be applied after structured parsing and appropriate decoding, not through raw string-prefix assumptions. See [[uri-syntax]].

## Trust Boundary

The server is useful for discovery and status, but **cryptographic verification remains essential on the client side**. Clients should verify signatures and fingerprints locally, not trust server assertions blindly.

The server's publish/discovery role is adjacent to, but distinct from, DID resolution. [[source-did-1-1]] defines DID methods and DID documents for URI-based decentralized identifiers; EBP's server currently serves EBP identity records, details, revocations, and hierarchy state rather than acting as a DID method or DID resolver. See [[decentralized-identifiers]].

## Database

- Supports SQLite (default, `DB_TYPE=sqlite`) and PostgreSQL (`DB_TYPE=psql`).
- Schema and adapters organized in `server/db/`: `adapter.ts` (abstract base), `sqlite.ts`, `postgres.ts`, and `index.ts` (factory + query functions).

## Related Pages

- [[component-cli]]
- [[component-gui]]
- [[component-website]] — hosts a browser-based verifier that calls `POST /api/v1/verify-signature`
- [[uri-syntax]]
- [[decentralized-identifiers]]
- [[revocation-system]]
- [[identity-model]]
- [[overview]]
- [[source-google-cloud-unverified-apps]]
- [[source-google-oauth2-web-server]]
- [[source-google-cross-account-protection-risc]]

## Sources

- `ReadMe.md`
- `server/main.ts`, `server/handlers/`, `server/db/`
- `server/mail-oauth.ts`
- `wiki/raw/rfc3986.txt` → [[source-rfc-3986]]
- `wiki/raw/Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]]
- `wiki/raw/Unverified apps - Google Cloud Platform Console Help.md` → [[source-google-cloud-unverified-apps]]
- `wiki/raw/Using OAuth 2.0 for Web Server Applications  _  Authorization.md` → [[source-google-oauth2-web-server]]
- `wiki/raw/Protect user accounts with Cross-Account Protection  _  Cross-Account Protection (RISC).md` → [[source-google-cross-account-protection-risc]]
