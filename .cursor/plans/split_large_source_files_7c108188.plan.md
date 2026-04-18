---
name: Split large source files
overview: Break the 6 largest source files (ranging from 709 to 4467 lines) into smaller, focused modules organized by logical domain, while preserving all existing behavior and test compatibility.
todos:
  - id: split-gui-app
    content: Split gui/app.js (4467 lines) into ~9 ES modules under gui/js/ with app.js as thin bootstrap
    status: completed
  - id: split-local-backend
    content: Split gui/local-backend/main.ts (4014 lines) into ~8 modules (http, identity, contacts, mail-account, mail-imap, mail-oauth, hierarchy, routes)
    status: completed
  - id: split-server-main
    content: Split server/main.ts (2216 lines) into ~8 modules (cors, rate-limit, body, mail-oauth, verify-email, handlers/*)
    status: completed
  - id: split-cli-main
    content: Split cli/main.ts (1493 lines) into ~6 command modules under cli/commands/
    status: completed
  - id: split-server-db
    content: Split server/db.ts (891 lines) into db/adapter.ts, db/sqlite.ts, db/postgres.ts, db/index.ts
    status: completed
  - id: update-wiki
    content: Update wiki pages (component-gui, component-server, component-cli, index, log) to reflect new file structures
    status: completed
isProject: false
---

# Split Large Source Files Into Smaller Modules

## Candidates (sorted by size)

| File | Lines | Priority |
|------|-------|----------|
| [gui/app.js](gui/app.js) | 4467 | High |
| [gui/local-backend/main.ts](gui/local-backend/main.ts) | 4014 | High |
| [server/main.ts](server/main.ts) | 2216 | High |
| [cli/main.ts](cli/main.ts) | 1493 | Medium |
| [server/db.ts](server/db.ts) | 891 | Medium |
| [core/Identity.ts](core/Identity.ts) | 709 | Low |

---

## 1. `gui/app.js` (4467 lines --> ~9 modules)

This is a single ES module loaded via `<script type="module">` in `index.html`. It has 114 named functions, a large `state` object, and no imports/exports. The split strategy converts it into proper ES modules that `app.js` orchestrates.

**New file structure:**

- `gui/js/state.js` -- The `state` object, constants (`DEFAULT_SERVER_URL`, `LOCAL_BACKEND_ORIGIN`), and preference helpers (`loadBooleanPreference`, `saveBooleanPreference`, `loadUiPreferences`)
- `gui/js/api.js` -- `api()`, `sleep()`, status/loading helpers (`setStatus`, `setButtonLoading`, `withLoading`)
- `gui/js/modals.js` -- `showConfirmModal`, `closeModal`, `requestPassword`, `requestTextInput`, `closePasswordModal` and associated DOM refs
- `gui/js/crypto-utils.js` -- `hashTextSha256Hex`, `readFileAsBase64`, `base64ToUint8Array`, `bytesToHex`, `hashFileSha256Hex`, `generateRandomSaltHex`, `buildFileSignMessage`, `safeDownloadFileName`, download/upload helpers
- `gui/js/contact-search.js` -- `initContactSearch`, `filterContacts`, `renderContactDropdown`, `highlightMatch`, `escapeRegex`, `selectContact`, `handleSearchKeydown`, `updateHighlight`, `closeAllDropdowns`
- `gui/js/render.js` -- `renderContext`, `renderIdentities`, `handleIdentityClick`, `renderContacts`, `showContactDetails`, `renderServerIdentities`, `renderServerIdentitiesPagination`, `importServerIdentityAsContact`, `loadServerIdentities`, `updateVerifyResult`, `setResultBadge`, `escapeHtml`, `renderIdentityDetails`, `loadPublicIdentityInfo`, `loadServerDetailsForCurrentIdentity`
- `gui/js/hierarchy.js` -- All hierarchy tree SVG functions (`_layoutTree`, `renderHierarchyTreeSVG`, tooltip helpers), certificate list rendering, proposal accept/reject, `navigateToHierarchyWithContact`
- `gui/js/mail.js` -- Everything from mail account/OAuth through `initMailPage` (~1000 lines): account CRUD, OAuth flow, inbox rendering, compose, reader, pagination, mail credentials
- `gui/js/revocation.js` -- `updateRevokeDetailPathOptions`, `updateRevocationStatus`, and revocation form listeners

**`gui/app.js` becomes a thin ~50-line bootstrap:** imports all modules, calls `loadUiPreferences()`, `initNavigation()`, `initCollapsibleSections()`, `loadAll()`. Navigation + collapsible sections stay in `app.js` since they wire everything together.

**`gui/index.html` change:** The `<script type="module" src="/app.js">` stays as-is; `app.js` imports from `./js/...`.

---

## 2. `gui/local-backend/main.ts` (4014 lines --> ~8 modules)

This is a Deno HTTP server entrypoint with a single 2750-line `handleRequest` function. Nothing is exported. Tests use a separate `test_handler.ts` reimplementation.

**New file structure:**

- `gui/local-backend/http.ts` -- `HttpError` class, `json()`, `readJson()`, `contentType()`, `tryServeStatic()`, CORS headers constant
- `gui/local-backend/identity.ts` -- `loadIdentity`, `loadIdentityPublic`, `saveIdentity`, `resolveServer`
- `gui/local-backend/contacts.ts` -- `listContacts`, `findContactRecord`, `deleteContact`, `computeExternalFingerprint`
- `gui/local-backend/mail-account.ts` -- Mail types, `normalizeMailConfig`, `getMailStore`, `saveMailStore`, encrypted secrets (derive key, encrypt, decrypt, unlock, status), `buildSmtpAuth`, `resolveMailAccount`
- `gui/local-backend/mail-imap.ts` -- `buildImapClient`, `safeImapDisconnect`, `isNoConnectionError`, `withImapReconnect`, `withMailboxLock`, mail parsing helpers (`getAddressText`, `extractEmailAddress`, `extractEbpPayload`)
- `gui/local-backend/mail-oauth.ts` -- OAuth types, provider config, `exchangeOAuthCode`, `refreshOAuthToken`, `pruneExpiredOAuthState`, `toOAuthProvider`
- `gui/local-backend/hierarchy.ts` -- Local hierarchy cert storage, pending proposals, `buildHierarchyTreeFromCertificates`, `fingerprintColor`
- `gui/local-backend/routes.ts` -- **Exported `handleRequest`** function with the route dispatch, importing handlers from the above modules. Each route branch calls into the extracted module functions.
- `gui/local-backend/main.ts` -- Slim entrypoint: imports, env loading, constants, calls `serve(handleRequest, ...)`.

**Key benefit:** Exporting `handleRequest` from `routes.ts` lets tests import it directly, eventually replacing the duplicated `test_handler.ts` (1240 lines).

---

## 3. `server/main.ts` (2216 lines --> ~8 modules)

Already has some extraction (`db.ts`, `crypto.ts`, `detail.ts`, `hierarchy.ts`, `revocation.ts`, `state.ts`, `types.ts`). The remaining `main.ts` is mostly route handlers + infrastructure.

**New file structure:**

- `server/cors.ts` -- `isOriginAllowed`, `buildCorsHeaders`, `buildSecurityHeaders`, origin/HSTS env config
- `server/rate-limit.ts` -- `RATE_LIMITS`, `rateLimitStore`, `checkRateLimit`, `getClientIp`, cleanup interval
- `server/body.ts` -- `MAX_BODY_SIZE`, `LIMITS`, `readJsonBody`, `validateStringLength`
- `server/mail-oauth.ts` -- OAuth types/config, JWT helpers, `handleOAuthExchange`, `handleOAuthRefresh`
- `server/verify-email.ts` -- Token generation, `sendVerificationEmail`, `getPublicBaseUrl`, HTML page handlers (`handleRequestVerifyEmail`, `handleVerifyEmailPage`, `handleVerifyEmailConfirm`, `renderVerifyEmailPage`, `html`)
- `server/handlers/identity.ts` -- `handlePostIdentity`, `handleGetIdentity`, `handlePostDetail`
- `server/handlers/verify.ts` -- `parseVerifyInput`, `verifySignatureWithIdentity`, `handleVerifySignature`
- `server/handlers/revocation.ts` -- `handlePostRevocation`, `handleGetRevocations`
- `server/handlers/hierarchy.ts` -- All `handlePost/GetHierarchy*` handlers
- `server/handlers/discovery.ts` -- `handleListIdentities`, `handleSearchIdentities`, `coerceNumber`
- `server/main.ts` -- Slim: DB lifecycle (`getDb`, `replaceDb`, `closeDb`), `handleRequest` router, `startServer`, exports for testing, `json`/`attachCors`/`logRequest` response helpers.

---

## 4. `cli/main.ts` (1493 lines --> ~6 modules)

Script entrypoint with `cmd*` functions for each subcommand. Already has `utils.ts` for shared helpers.

**New file structure:**

- `cli/commands/identity.ts` -- `cmdGenerate`, `cmdInfo`, `cmdExportPublic`, `cmdListIdentities`, `cmdUseIdentity`, `cmdShowDetails`
- `cli/commands/contacts.ts` -- `cmdImportContact`, `cmdListContacts`, `loadContact`
- `cli/commands/crypto.ts` -- `cmdSign`, `cmdVerify`, `cmdEncrypt`, `cmdDecrypt`
- `cli/commands/files.ts` -- `cmdEncryptFile`, `cmdDecryptFile`
- `cli/commands/details.ts` -- `cmdAttachDetail`, `cmdRevokeDetail`, `cmdRevokeIdentity`, `cmdGenerateRevocationCert`
- `cli/commands/server.ts` -- `cmdPublishIdentity`, `cmdFetchIdentity`, `cmdListServerIdentities`, `cmdServer`, `asServerEntry`
- `cli/main.ts` -- `loadIdentity`, `saveIdentity`, `printHelp`, `main`, arg parsing, and the `switch` dispatch (importing from `commands/*`)

Shared helpers (`randomHex`, `baseName`, `safeFileName`) move to `cli/utils.ts` since they are CLI-specific.

---

## 5. `server/db.ts` (891 lines --> 3 modules)

- `server/db/adapter.ts` -- `DatabaseAdapter` abstract class, `DatabaseQueryParams` type, `coerceNumber` helper
- `server/db/sqlite.ts` -- `SqliteDatabaseAdapter` (schema + migrations)
- `server/db/postgres.ts` -- `PostgresDatabaseAdapter` (env loading, schema, SQL rewrite)
- `server/db/index.ts` -- Re-exports adapters + `initDb` factory + all query functions (`insertIdentity`, `getIdentity`, `searchIdentities`, etc.)

Existing importers (`server/main.ts`, `server/hierarchy.ts`, tests) change from `./db.ts` to `./db/index.ts` (or just `./db/` with Deno resolution).

---

## 6. `core/Identity.ts` (709 lines --> leave as-is or light split)

At 709 lines with a single cohesive class, this is the lowest priority. If we split it, the natural cut is:

- `core/Identity.ts` -- Class definition, constructor, messaging methods, detail attach/get/verify, fingerprint/summary
- `core/IdentityStorage.ts` -- `IdentityStorageFormat` type, `toStorageFormat`, `fromStorageFormat`, `readPublicData`, `toJSON`, `fromJSON`
- `core/IdentityRevocation.ts` -- `revokeDetail`, `createIdentityRevocation`, `generateEmergencyRevocationCertificate`, `VerifyRevocationCertificate`, revocation state getters

However, since these are all methods on one class and the file is well-organized with clear sections, the ROI is lower. **Recommend deferring this split** unless the file continues growing.

---

## Cross-cutting concerns

- **Wiki updates:** Per the wiki-maintainer rule, update `wiki/index.md` and relevant component pages (`component-gui.md`, `component-server.md`, `component-cli.md`) to reflect new file structures. Append to `wiki/log.md`.
- **Test impact:** The biggest risk is `gui/local-backend/tests/test_handler.ts` (1240 lines) which reimplements the handler. Once `routes.ts` exports `handleRequest`, tests can import it directly and `test_handler.ts` can be retired (separate follow-up).
- **Import paths:** Deno uses explicit `.ts` extensions; all new imports must include them. For `gui/js/*.js`, standard ES module `import` with `.js` extensions.
- **No behavioral changes:** Each split is purely structural. All functions keep identical signatures and logic.