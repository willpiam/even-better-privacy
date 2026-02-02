# EBP Server v1 (Reference) Plan

Keep the server minimal: accept public identities, accept signed details, and serve them back to clients. No federation and no fancy abuse controls beyond simple input limits.

## Scope
- Provide a public read API for identities and their details.
- Provide a write API to register an identity and to attach signed details.
- Use the existing EBP key algorithms: signing (`dilithium`, `sphincs`) and encryption (`kyber`).
- Store data in SQLite; keep schema and migrations simple.

## Non-goals (for v1)
- Federation or cross-server trust.
- Derived trust scoring / web-of-trust calculations (we only store attestations).
- Complex rate limiting or proof-of-work (basic body size limits are enough).

## Data Model (SQLite)
- `identities`
  - `fingerprint` (PRIMARY KEY, hex string; derived via `Identity.toFingerprint()`)
  - `signing_key_type` (`dilithium` | `sphincs`)
  - `encryption_key_type` (`kyber`)
  - `signing_key` (public key, base64 or hex matching library output)
  - `encryption_key` (public key, base64 or hex)
  - `signing_key_details` (JSON; e.g., variant)
  - `encryption_key_details` (JSON; e.g., variant)
  - `created_at` (integer ms)
- `details`
  - `id` (PRIMARY KEY)
  - `identity_fingerprint` (FK → identities.fingerprint)
  - `path` (string)
  - `detail` (string)
  - `proof` (hex string of the signed detail record, same structure used by `Identity.attachDetail`)
  - `created_at` (integer ms; optional, can be derived from proof)
  - Unique constraint on (`identity_fingerprint`, `path`) to avoid duplicates.

## Canonical rules (align with current library)
- Fingerprint: hex-encoded `sha256` of concatenated raw fingerprints of signing and encryption keys (`Identity.toFingerprint()`).
- Detail proof format: hex-encoded JSON of `{ nonce, path, detail, timestamp, signature }` where `signature` signs the same object but with `signature: null` (matches `Identity.attachDetail`).
- Accept only supported algorithms and variants already used by the core library.

## API (HTTP, JSON, prefix `/api/v1`)
- `GET /health` → `{ status: "ok" }`.
- `GET /identity/:fingerprint`
  - Returns the identity record and attached details.
  - Response shape: `{ fingerprint, signingKeyType, encryptionKeyType, signingKey, encryptionKey, signingKeyDetails, encryptionKeyDetails, details: { [path]: [detail, proof] } }`.
- `POST /identity`
  - Body: `{ signingKeyType, encryptionKeyType, signingKey, encryptionKey, signingKeyDetails, encryptionKeyDetails }`.
  - Server computes fingerprint; rejects if payload keys do not match the derived fingerprint or if the fingerprint already exists.
  - On success: `{ fingerprint }`.
- `POST /detail`
  - Body: `{ fingerprint, path, detail, proof }`.
  - Server verifies the proof:
    - Decodes proof (hex → JSON).
    - Confirms `path` and `detail` match the record.
    - Reconstructs the signed payload with `signature: null` and verifies with the identity’s signing key.
    - Confirms nonce is new for that identity/path.
  - On success: `{ ok: true }`.

## Minimal validation / abuse controls
- Body size limits (e.g., a few KB) and simple string length caps.
- Reject unknown algorithms/variants.
- Reject duplicate identities (same fingerprint) and duplicate detail paths.

## CLI contract (intended flow)
- `ebp export-public` → data matches `POST /identity`.
- `ebp import` / `contacts` → uses `GET /identity/:fingerprint` to pull keys and details.
- Adding a detail from CLI uses the existing `attachDetail` proof format and submits via `POST /detail`.
- Server base URL is read from `~/.ebp/state.json` as already planned.

## Implementation sketch (Deno)
- HTTP server: native Deno HTTP or `std/http`.
- SQLite: `deno-sqlite`.
- Routing: minimal hand-rolled or a tiny router; keep dependencies small.
- Startup: ensure tables exist (lightweight migration), load DB path from env/flag, expose `/health`.

## Operational defaults
- Transport: assume TLS is handled by a reverse proxy; server can listen on localhost/http.
- Config: `PORT` (default 8080), `DB_PATH` (default `./ebp.sqlite`), optional `LOG_LEVEL`.
- CORS: allow CLI origin (can be permissive `*` for reference build).
- Logging: structured JSON logs for requests and errors; redact payloads only if needed.

## Error responses (suggested)
- 400 for validation/signature failures with `{ error: "reason" }`.
- 404 if identity not found on GET.
- 409 on duplicate identity or duplicate detail path.
- 500 for unexpected errors.

## Updates and constraints
- Detail updates: v1 disallows replacing an existing `path`; require unique (`identity_fingerprint`, `path`). Future versions can allow updates with higher `nonce`.
- Nonce checks: ensure nonce is strictly increasing per identity (not just per path) and not previously seen.
- Payload caps: enforce modest body size and field length limits (e.g., detail ≤ a few KB, proof length consistent with expected encoding).

## Migrations / versioning
- On startup, create tables if missing. If schema changes, use simple integer `schema_version` table and apply forward-only migrations.
- Prefix API with `/api/v1` and keep responses additive for future compatibility.

## Testing (reference expectations)
- Unit: proof verification against stored identity keys; fingerprint derivation; rejection paths (bad signature, mismatched detail/path, duplicate path, unknown algorithm).
- Integration: happy-path `POST /identity` → `POST /detail` → `GET /identity/:fingerprint`.
- Persistence: restart server and ensure data persists in SQLite.

## Optional / can defer
- Structured JSON logging (plain text logs are fine for a reference server).
- CORS tuning (can leave permissive `*`).
- Explicit migration/version table (for v1 you can just create tables if missing).
- Config surface beyond `PORT` and `DB_PATH`.
