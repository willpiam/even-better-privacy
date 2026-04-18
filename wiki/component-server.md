---
title: "EBP Server Component"
type: component
status: active
last_updated: 2026-04-10
source_count: 2
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

## Trust Boundary

The server is useful for discovery and status, but **cryptographic verification remains essential on the client side**. Clients should verify signatures and fingerprints locally, not trust server assertions blindly.

## Database

- Supports SQLite (default, `DB_TYPE=sqlite`) and PostgreSQL (`DB_TYPE=psql`).
- Schema and adapters organized in `server/db/`: `adapter.ts` (abstract base), `sqlite.ts`, `postgres.ts`, and `index.ts` (factory + query functions).

## Related Pages

- [[component-cli]]
- [[component-gui]]
- [[component-website]] — hosts a browser-based verifier that calls `POST /api/v1/verify-signature`
- [[revocation-system]]
- [[identity-model]]
- [[overview]]

## Sources

- `ReadMe.md`
- `server/main.ts`, `server/handlers/`, `server/db/`
