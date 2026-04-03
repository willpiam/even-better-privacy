---
name: Opaque Details Feature
overview: Add "opaque details" support where detail values are SHA-256 hashed before being signed and uploaded, allowing users to commit to details (email, phone, etc.) without publicly revealing them. Viewers can verify opaque details by entering a candidate value and comparing its hash.
todos:
  - id: external-identity-type
    content: Add resolvedOpaqueDetails field to ExternalIdentity type
    status: completed
  - id: local-backend-detail
    content: "Hash opaque detail values in POST /detail when path starts with opaque::"
    status: completed
  - id: local-backend-resolve
    content: Add POST /contacts/resolve-opaque endpoint to verify and save matches
    status: completed
  - id: html-checkbox
    content: Add Opaque checkbox to the add-detail form in index.html
    status: completed
  - id: frontend-add-detail
    content: "Prepend opaque:: prefix when Opaque checkbox is checked in app.js"
    status: completed
    dependencies:
      - html-checkbox
  - id: frontend-render-own
    content: "Update renderIdentityDetails to show opaque badge for opaque:: details"
    status: completed
  - id: frontend-render-contact
    content: Update showContactDetails to show hash, Check button, and resolved values
    status: completed
    dependencies:
      - local-backend-resolve
  - id: cli-opaque-flag
    content: Add --opaque flag to CLI detail command with hashing logic
    status: completed
  - id: test-handler
    content: Mirror opaque handling in test_handler.ts
    status: completed
---

# Opaque Details

## Architecture

The existing detail flow is: user enters path + value -> `Identity.attachDetail(path, value)` signs and stores `[value, proof]` -> optionally pushes `{path, detail, proof}` to keyserver.

For opaque details, the local backend will hash the value before calling `attachDetail`, so the signed proof contains the hash. The keyserver receives only the hash -- no protocol or server changes are needed. On the viewer side, a new "Check" button lets users enter a candidate value, which is hashed and compared locally. Matched values are persisted in the contact's local JSON file.

```mermaid
sequenceDiagram
    participant User
    participant Frontend as GUI Frontend
    participant Backend as Local Backend
    participant Core as Identity.attachDetail
    participant Server as Keyserver

    User->>Frontend: Enter path="email", value="a@b.com", check Opaque
    Frontend->>Backend: POST /detail {path: "opaque::email", detail: "a@b.com", password, push}
    Backend->>Backend: hash = sha256Hex("a@b.com")
    Backend->>Core: attachDetail("opaque::email", hash)
    Core->>Core: Sign {path, detail: hash, nonce, timestamp}
    Backend->>Server: POST /detail {path: "opaque::email", detail: hash, proof}
    Note over Server: Stores hash only, plain text never sent
```

## Changes by Layer

### 1. Core (`core/MessageHash.ts`) -- no changes

`sha256Hex` is already exported and available for hashing opaque values.

### 2. Core (`core/ExternalIdentity.ts`) -- add optional field

Add `resolvedOpaqueDetails?: Record<string, string>` to the `ExternalIdentity` type to store locally-resolved plain-text values for opaque details.

### 3. GUI Local Backend ([gui/local-backend/main.ts](gui/local-backend/main.ts))

- **`POST /api/v1/detail`**: When path starts with `"opaque::"`, hash the `detail` value via `sha256Hex()` before calling `attachDetail()`. The response and local storage only contain the hash.
- **New endpoint `POST /api/v1/contacts/resolve-opaque`**: Accept `{fingerprint, path, value}`. Hash `value`, compare against the contact's stored detail hash. If match, save `value` into the contact's `resolvedOpaqueDetails` map in the JSON file and return success. If no match, return an error.

### 4. GUI Frontend ([gui/app.js](gui/app.js))

- **Add detail form**: Add an "Opaque" checkbox (`#detail-opaque`). When checked, prepend `"opaque::"` to the path before submitting.
- **`renderIdentityDetails()`**: Detect `opaque::` prefix on detail paths. Show an "Opaque" badge and truncate the hash display for readability.
- **`showContactDetails()`**: For details with `opaque::` prefix:
  - Show the full path (with prefix), the hash value, and a small "Check" button.
  - If a resolved value exists (from `resolvedOpaqueDetails`), show the plain-text value with a verified indicator instead/alongside the hash.
  - Clicking "Check" shows an inline input field. On submit, call `POST /api/v1/contacts/resolve-opaque`. On success, re-render with the resolved value and indicator.

### 5. GUI HTML ([gui/index.html](gui/index.html))

- Add the `#detail-opaque` checkbox to the add-detail form (in the row alongside "Push to server").

### 6. CLI ([cli/main.ts](cli/main.ts))

- `cmdAttachDetail`: Add `--opaque` flag. When set, prepend `"opaque::"` to path and hash the value via `sha256Hex()` before calling `attachDetail()`.
- Update help text to document the `--opaque` flag.

### 7. Test handler ([gui/local-backend/tests/test_handler.ts](gui/local-backend/tests/test_handler.ts))

- Mirror the local backend changes: handle `opaque::` prefix in the detail endpoint and add the resolve-opaque endpoint.