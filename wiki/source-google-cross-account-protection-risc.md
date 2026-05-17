---
title: "Google Cross-Account Protection (RISC)"
type: source-summary
status: active
last_updated: 2026-05-17
source_count: 1
tags:
  - source
  - oauth
  - google
  - risc
  - security
  - identity-provider
---

# Google Cross-Account Protection (RISC)

Clipped Google Identity documentation for **Cross-Account Protection**: security event notifications for apps that let users sign in with Google. The service is based on the OpenID Foundation [RISC](https://openid.net/wg/sse/) (Security Event Token) standard.

## Summary

When a user's Google Account undergoes a security-relevant change (compromise, credential reset, bulk disable, token revocation, etc.), Google can notify the relying application via **security event tokens**—signed JWTs POSTed to an HTTPS **receiver endpoint** the app operates.

Tokens expose minimal data: event type, timestamp, and an identifier for the affected user (`sub` matching Google Sign-In / OpenID Connect `sub`). The app uses them to take protective action (end sessions, delete stored refresh tokens, disable Google-based recovery, etc.).

### Prerequisites

- Same Google Cloud project as Google Sign-In / Gmail OAuth.
- Users must have granted **`profile` or `email`** scopes (default for Sign In With Google; required for events to be delivered).
- OAuth consent screen configured in GCP.

### Setup (high level)

1. **API Console:** Create a service account with **RISC Configuration Admin** (`roles/riscconfigs.admin`), download JSON key; enable **RISC API**; note OAuth **client IDs** used for Sign-In.
2. **Receiver endpoint:** HTTPS POST handler that **validates then decodes** each token:
   - Load issuer and `jwks_uri` from `https://accounts.google.com/.well-known/risc-configuration`.
   - Resolve signing key by JWT `kid` from Google's JWKS document.
   - Verify signature, `aud` ∈ your client IDs, `iss` matches discovery issuer.
   - **Do not reject on `exp`**—events are historical; Google documents accepting unbounded leeway.
   - On success return **HTTP 202**; on validation failure **HTTP 400**.
3. **Register stream:** Service-account JWT (`aud`: RISC management API) → `POST https://risc.googleapis.com/v1beta/stream:update` with delivery URL and `events_requested`. Delivery endpoint must be HTTPS and on a project **authorized domain** (or listed domain).

### Token payload

- `jti`: unique event id (use for **deduplication**; duplicates possible on redelivery).
- `events`: map from event-type URI to `subject` (typically `iss-sub` with Google `sub`; may include `email` when `subject_type` is `id_token_claims`).
- OAuth token events use [token subject identifiers](https://openid.net/specs/oauth-event-types-1_0-01.html#subject-identifier-token) (`refresh_token` only; `prefix` or `hash_base64_sha512_sha512`).

### Supported event types (selected)

| Event | Suggested response |
|---|---|
| `sessions-revoked` | **Required:** end user's app sessions. |
| `tokens-revoked` / `token-revoked` | **Required:** delete matching stored refresh tokens; re-consent on next access. |
| `account-disabled` (`reason=hijacking`) | **Required:** re-secure account (end sessions). |
| `account-disabled` (other reasons) | Analyze activity; may disable Google Sign-In / email recovery. |
| `account-enabled` | Re-enable Google Sign-In / recovery as appropriate. |
| `account-credential-change-required` | Monitor for suspicious activity. |
| `verification` | Log test delivery (`state` in event). |

Missed events are possible if the receiver is down for extended periods (limited retries).

### Management API

- Stream config: `GET/POST https://risc.googleapis.com/v1beta/stream` / `stream:update`
- Pause/resume: `POST .../stream/status:update` with `enabled` or `disabled` (no buffering while disabled)
- Test: `POST .../stream:verify` with `{ "state": "..." }` (subscribe to `verification` event type)

## EBP relevance

EBP's Gmail integration ([[component-gui]], [[component-server]] mail OAuth proxy) stores **refresh tokens** and binds mail accounts to Google identities. Cross-Account Protection is the provider-recommended way to learn when those tokens or sessions should be invalidated without waiting for the next failed refresh.

**Current status:** Not documented as implemented in EBP. A production deployment would add an HTTPS receiver (likely on [[component-server]] or a dedicated ops endpoint), map Google `sub` to stored mail accounts, and react to `sessions-revoked`, `token-revoked`, and `account-disabled` per Google's response table. Complements [[source-google-oauth2-web-server]] token revocation and user-driven revoke at [Google Account permissions](https://myaccount.google.com/permissions).

Pair with [[source-google-cloud-unverified-apps]] for OAuth client verification; RISC requires at least one OAuth client in the project.

## Sources

- `wiki/raw/Protect user accounts with Cross-Account Protection  _  Cross-Account Protection (RISC).md` (clipped from https://developers.google.com/identity/protocols/risc)

## Related

- [[source-google-oauth2-web-server]]
- [[source-google-cloud-unverified-apps]]
- [[component-server]]
- [[component-gui]]
- [[security-audit-2026-04/phase-04-gui]]
