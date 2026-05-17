---
title: "Google OAuth 2.0 for Web Server Applications"
type: source-summary
status: active
last_updated: 2026-05-17
source_count: 1
tags:
  - source
  - oauth
  - google
  - mail
  - identity-provider
  - security
---

# Google OAuth 2.0 for Web Server Applications

Clipped Google Identity documentation for the **authorization-code** OAuth 2.0 flow used by server-side web applications that can store a **client secret** and maintain session state.

## Summary

This flow is for **user authorization** (not service-account project access). The application:

1. Builds an authorization request (`client_id`, `redirect_uri`, `response_type=code`, `scope`, optional `state`, `access_type`, `include_granted_scopes`, `prompt`, `login_hint`).
2. Redirects the user to `https://accounts.google.com/o/oauth2/v2/auth` (HTTPS only).
3. Receives either an **authorization code** or an **error** on the registered `redirect_uri` query string.
4. Exchanges the code at `https://oauth2.googleapis.com/token` with `grant_type=authorization_code`, matching `redirect_uri`, and (for confidential clients) `client_secret`.
5. Uses the **access token** in API requests, preferably as `Authorization: Bearer`.

### Key parameters and behaviors

| Topic | Detail |
|---|---|
| `redirect_uri` | Must **exactly** match a URI registered for the OAuth client (scheme, case, trailing `/`). Mismatch → `redirect_uri_mismatch`. |
| `access_type=offline` | Recommended for web server apps that need refresh without the user present; refresh token returned on **first** successful code exchange only (unless re-consent with `prompt=consent`). |
| `state` | Recommended CSRF mitigation: random value in the auth request, validated on callback. |
| `include_granted_scopes=true` | **Incremental authorization**: new tokens cover previously granted scopes for the project. |
| Granular consent | When requesting multiple scopes, users may grant a subset; apps must check `granted_scopes` / `scope` and degrade features accordingly. |
| API usage | Prefer `Authorization: Bearer` header over query-string tokens. |

### Token refresh and revocation

- **Refresh:** `POST https://oauth2.googleapis.com/token` with `grant_type=refresh_token` and the stored refresh token. Access tokens expire; refresh tokens remain valid until user revocation or provider invalidation. Per-client and per-user refresh-token limits apply.
- **Revoke:** `POST https://oauth2.googleapis.com/revoke` with the access or refresh token; revoking an access token also revokes its paired refresh token.

### Redirect URI validation (Google-specific)

Beyond exact registration match, Google enforces rules aligned with [[source-rfc-3986]] URI components: HTTPS required (except localhost), no raw public IPs (localhost exempt), TLD on public suffix list, no `googleusercontent.com` host, no userinfo, no path traversal, no open redirects in query, no fragments, and restrictions on wildcards / null bytes in encodings. See [[uri-syntax]].

### Errors (selected)

Common authorization-endpoint errors include `admin_policy_enforced`, `disallowed_useragent` (embedded WebViews), `org_internal`, `invalid_client`, `deleted_client`, `redirect_uri_mismatch`, and `invalid_grant` (expired/invalid code or refresh). Token exchange `invalid_grant` usually requires restarting the consent flow.

### Cross-Account Protection

Google recommends implementing [[source-google-cross-account-protection-risc]] so the app can react to Google Account security events (session/token revocation, account disabled, etc.) affecting users who signed in with Google.

## EBP relevance

EBP's Gmail mail integration follows this web-server pattern:

- **[[component-gui]]** runs the browser OAuth redirect/callback on the local backend (`gui/local-backend/mail-oauth.ts`) and stores refresh tokens in the user's mail credential store.
- **[[component-server]]** exposes `POST /api/v1/mail/oauth/exchange` and `POST /api/v1/mail/oauth/refresh`, proxying code exchange and refresh to `https://oauth2.googleapis.com/token` so the **client secret** stays on the server (`server/mail-oauth.ts`).
- Redirect URIs must match values registered in Google Cloud for the EBP OAuth client (commonly `http://127.0.0.1:8787/...` for local flows; see audit notes on port stability in [[security-audit-2026-04/phase-06-supply-chain]]).
- Operators should request **minimal Gmail/IMAP scopes**, use **offline** access only when background refresh is needed, validate **`state`** on callback, and plan for **unverified-app** UX until [[source-google-cloud-unverified-apps]] verification completes.
- **RISC / Cross-Account Protection** is not documented as implemented in EBP today; it is a recommended hardening step for production Gmail-linked accounts (see [[source-google-cross-account-protection-risc]]).

## Sources

- `wiki/raw/Using OAuth 2.0 for Web Server Applications  _  Authorization.md` (clipped from https://developers.google.com/identity/protocols/oauth2/web-server)

## Related

- [[source-google-cloud-unverified-apps]]
- [[source-google-cross-account-protection-risc]]
- [[component-server]]
- [[component-gui]]
- [[component-email-extension]]
- [[uri-syntax]]
- [[email-transport]]
