# Holistic remediation plan and execution ledger

Baseline: `736ffbb` (2026-11-16). Sources: [Codex review](codex_holistic_issue_review.md), [Claude review](cursor_w_claude_holistic_issue_review.md), and all 66 [historical issue records](https://github.com/willpiam/even-better-privacy/blob/8a2c25c/issue_tracker/issues.json). Resolved entries were subsequently removed from the active tracker while preserving `next_id: 67`.

## Implementation decisions

- Repair shared contracts incrementally; retain desktop JSON interoperability and platform I/O adapters. No new mail proxy or local database migration.
- Test production routes, actual producers/consumers, adversarial protocol fixtures, deterministic interleavings, and failed reads. Agreement between copies alone is insufficient.
- Keep current file-signature bytes but require canonical hex salt and hash at every constructor/verifier. A future injective signed format is separate work; ambiguous legacy salts are rejected.
- Reject unsupported HD paths and unauthenticated legacy state explicitly. Do not silently rewrite derivation provenance or downgrade authenticated state.
- Preserve mail octets through transport and parsing; share pure header/address/MIME policies without assuming Node libraries run on React Native.
- Serialize complete local read/modify/replace operations, use atomic private replacement, and lock shared desktop stores across processes. Damaged contact records are isolated; vault failures remain errors.
- Never replay writes or wallet sends with uncertain outcomes. Separate reconnecting from replaying. Keep provider and ledger evidence explicit.
- Reserve authorization nonces atomically across consumers. Verification-mail issuance must preserve active tokens and impose atomic detail and recipient budgets, including automatic issuance.
- Optimize Base64/JSON before widening route-specific file budgets. Retain existing control-route limits and bound nested/encrypted representations.
- Do not deploy, send real mail, submit wallet transactions, or migrate a live database as part of local verification.

## Ordered work

| Step | Issues | Implementation and acceptance gate |
| --- | --- | --- |
| 1. Production assurance | #57, #64 | Replace the forked handler with the production dispatcher; adapt security/confirmation fixtures. Update all Tauri 2 APIs and add Deno/mobile/desktop CI. Compile where the toolchain permits. |
| 2. Immediate containment | #4, #12, #17–#19, #24, #32–#33, #43–#45, #54, #65 | Bind claimed identities to keys; reject ambiguous signature fields; invalidate pending unlocks; preserve vault/session semantics; validate contact/deployment destinations; preview without mutations; reject phantom collateral payments; remove unsafe replay. Each has a focused negative regression. |
| 3. Durable storage and contacts | #13, #16, #30, #34–#35, #52, #55 | Shared refresh/cache rules, safe isolated reads, atomic updates and unique certificate names. Reproduce overlapping operations and corruption; preserve metadata and user annotations; use a contact snapshot per lookup. |
| 4. Payloads, settings, recovery | #15, #27–#29, #31, #40–#42, #53, #60, #62 | Use strict codecs/builders, coordinate empty attachment support with C/Python, fail authenticated decrypt on bad signature, escape terminal controls, validate URLs at read/write boundaries and state MACs. Recovery distinguishes absence from failure across clients. |
| 5. Payments and verification issuance | #10–#11, #21–#23, #61, #66 | Share a per-order service between HTTP and worker; expire once per batch; contextual errors; fresh wallet quotes and bounded UTxO requests; atomic nonce consumption; token-stable bounded verification issuance. Test concurrent/replayed authorizations and provider responses. |
| 6. Structured mail | #1–#3, #5, #7, #9, #25–#26, #37, #46–#50, #56 | Shared headers/address grammar; octet-preserving adapters and MIME charset/entity selection; literal LIST records; charset-aware searches; ASCII-safe outbound MIME; complete SMTP replies and cancellable tests. Convert original bug reproductions into corrected-behavior checks. |
| 7. Bounded work and capacity | #6, #8, #14, #20, #36, #38–#39, #51, #58–#59, #63 | Validation-only JSON traversal; chunked Base64; projected server reads; correct BFS/Set membership; route-specific request budgets; native object-level attachment helpers and hashed recipient deduplication. Verify operation counts, interoperability, and supported file sizes. |
| 8. Final verification | all | Run relevant suites against production implementations, inspect the complete diff, and record evidence per issue. Preserve unresolved limitations explicitly; never close an issue solely because its parent changed. |

## Execution ledger

Checked entries have a production implementation and the indicated verification. Original issue descriptions and review documents remain historical evidence. Test references identify files in the repository, so the evidence can be rerun without this work session's logs.

- [x] #1 — `common/mail/Headers.ts` retains empty fields without consuming the next header. Shared mail contracts and the original `review_checks.mjs` regression pass.
- [x] #2 — FETCH and the shared IMAP command reader parse the exact tagged status atom. Failed FETCH, misleading response text, and TCP tests pass.
- [x] #3 — MIME transfer decoding produces bytes before declared-charset decoding. Shared raw Latin-1, Base64, and quoted-printable fixtures and mobile MIME tests pass.
- [x] #4 — SMTP parses complete multiline replies, accepts RCPT 250/251/252, and rejects completed failures promptly. The original regression and mobile TCP/SMTP tests pass.
- [x] #5 — Message detail extraction parses the header block once and reuses its map; body normalization is absent from the header helper. Shared header contracts and mobile fetch tests pass.
- [x] #6 — `validateJsonValue` validates the original tree without canonical sorting or copying; canonical serialization retains its separate behavior. Strict-JSON and canonicalization tests pass.
- [x] #7 — Incoming MIME and detail adapters use `common/mail/Headers.ts`, retaining ordered repeated fields. Empty/folded/repeated headers and all accepted line endings pass.
- [x] #8 — The duplicate-key scanner documents grammar validation, cursor entry/exit invariants, escapes, and delimiters. Escaped duplicate keys and invalid shared-JSON values are rejected by tests.
- [x] #9 — Quote/comment/angle-aware mailbox splitting is used by shared compose logic and its browser mirror. Golden fixtures include quoted commas, escaped quotes, Unicode, and multiple recipients.
- [x] #10 — The worker expires orders once per batch and calls `refreshPaymentOrder` directly. The 50-order regression observes exactly two global expiry statements.
- [x] #11 — Payment refresh failures carry stage and retryability; worker logs include the order ID and bounded reason. The 50-order regression checks each failure's context.
- [x] #12 — Shared contact refresh and mail authenticity bind opaque cleartext to the current claim hash and active revocation state. Shared stale/revoked-cache tests and actual CLI refresh tests pass.
- [x] #13 — Desktop/mobile contact enumeration isolates damaged neighbors; validated atomic imports preserve healthy records. CLI, GUI production-route, and mobile I/O regressions pass.
- [x] #14 — Core Base64 encoding uses bounded chunks; the GUI backend reexports it. A 4 MiB+1 byte independent Buffer comparison and existing file suites pass.
- [x] #15 — TypeScript and C accept empty attachment data while checking declared size. Native/Python and C–TypeScript empty attachment interoperability tests pass.
- [x] #16 — Complete pending-proposal mutations use a canonical-path cross-process lock and atomic replacement, including removals. Twenty overlapping additions retain unique IDs and concurrent removal/addition preserves both effects.
- [x] #17 — GUI contact operations validate aliases before path construction and reject symlink reads. Production import routes reject slash/backslash traversal, absolute paths, NUL, and forged identities.
- [x] #18 — Vault reads initialize only on confirmed absence, propagate corruption/read errors, and cannot save over an unread locked vault. PermissionDenied and corrupt-file regressions preserve bytes and leave the cache empty.
- [x] #19 — The active secret cache retains the full session map; only persistence-approved accounts are serialized. The GUI regression saves session-only passwords, verifies they remain available, and checks lock clears them.
- [x] #20 — Serialized hierarchy validation selects endpoint pairs inside its write transaction instead of hydrating certificates. Hierarchy graph/concurrency/failure tests pass.
- [x] #21 — Ethereum uses one canonical EIP-1193 send and exposes uncertain outcomes without retry. The checkout VM test observes exactly one send after a lost response.
- [x] #22 — Checkout refreshes before and after the account prompt and checks quote expiry. The server holds inventory and accepts delayed hash submission through a bounded grace period. Stale-quote VM and order/flow tests pass.
- [x] #23 — CIP-30 requests a CBOR funding amount plus fee margin; the server bounds input at 256 and selects at most 40 decoded inputs. A real unsigned-builder fixture with 41 fragmented UTxOs succeeds.
- [x] #24 — Mobile and GUI unlocks capture global/per-identity generations before awaited work; lock invalidates late results and wipes rejected keys. Deferred mobile lock-all and individual-lock regressions pass.
- [x] #25 — MIME parameters parse quoted boundaries with spaces and escapes. Shared and mobile quoted-boundary fixtures pass with existing nesting/entity limits retained.
- [x] #26 — MIME traversal excludes attachment entities before selecting display/EBP text. Mixed body/text-attachment and attachment-only fixtures pass.
- [x] #27 — CLI rejects hardening combinations the derivation API cannot represent, before mnemonic or key generation. CLI unsupported-path regressions pass.
- [x] #28 — HD numeric options require an entire unsigned decimal safe integer. CLI trailing-garbage and fractional-input regressions pass.
- [x] #29 — Shared discovery counts only authoritative absence; failures abort across CLI, GUI, and mobile. New servers return 404 for absence; narrowly recognized legacy 400 remains compatible. Status/failure contracts and recovery suites pass.
- [x] #30 — CLI refresh retains validated server fields, verification/revocation metadata, and same-identity local annotations through the shared merge. Its actual-fetch regression also checks changed claims invalidate caches.
- [x] #31 — Directory output escapes terminal controls, bidi controls, and line separators at rendering. A captured-output CLI regression verifies hostile remote text is inert.
- [x] #32 — FTP targets reject dot components, backslashes, controls, and root-equivalent paths; server PWD is checked before traversal/pruning. Fake-FTP unsafe-target tests pass.
- [x] #33 — Preview connects with directory creation disabled and treats a missing target as an empty planned destination. Fake-FTP existing/missing previews observe zero mutations.
- [x] #34 — Mobile resolution reuses one contact snapshot and loads an imported contact directly. The server-miss I/O regression observes one directory scan and one read per contact.
- [x] #35 — Opaque resolution updates use the known contact and reread only that record under its mutation queue. Twenty matches require one scan, 40 reads, and 20 atomic writes.
- [x] #36 — `getIdentityDetailView` returns details, verification metadata, and revocation paths from one projection. Server detail-view/directory tests pass.
- [x] #37 — GUI worker messages carry the original octets, honoring typed-array offset and length. An actual worker regression decodes a Latin-1 view as café.
- [x] #38 — GUI layout performs connected BFS before adding orphan roots. A three-generation golden tree matches the mobile layout with strictly increasing descendant levels.
- [x] #39 — Both layout implementations use Set membership and a queue cursor. A 2,000-sibling tree preserves matching coordinates without repeated array membership scans.
- [x] #40 — Failed signed decrypt exits nonzero before plaintext stdout. A real CLI subprocess regression tampers with a signature and observes no authenticated output.
- [x] #41 — CLI verification/decryption uses `parseEbpPayloadInput`, including strict JSON and current version rules. CLI future-version and duplicate-key regressions pass; the existing signed-file compatibility exception is retained.
- [x] #42 — Mobile emergency exports use the shared current wrapper version. Mobile revocation/storage and existing payload-version tests pass.
- [x] #43 — Mobile contact import/read requires the shared key/type/encoding/fingerprint validator. Forged fingerprint and malformed-key fixtures are rejected.
- [x] #44 — Mobile file verification validates embedded keys against both embedded and outer fingerprint claims. The actual mobile verifier regression rejects mismatched signer claims.
- [x] #45 — Core, browser GUI, website, and native file-signature builders require canonical hexadecimal hash/salt fields. Cross-client and native tests reject delimiter-bearing salts; generated current signatures remain interoperable.
- [x] #46 — IMAP LIST literal octets are associated with their response before Sent discovery. The mobile literal-LIST regression returns the actual mailbox name.
- [x] #47 — Non-ASCII rev1 searches include CHARSET UTF-8 with correctly encoded quoted terms. Mobile protocol tests check the emitted command.
- [x] #48 — Outbound Unicode headers use RFC 2047, Unicode bodies use Base64, and attachment parameters use RFC 2231. SMTP rejects raw non-ASCII sources/envelopes requiring unsupported SMTPUTF8. Actual MIME output is ASCII in mobile tests.
- [x] #49 — The shared formatter quotes/escapes display names; outbound From uses it. Compose round-trip and mobile MIME fixtures include comma-bearing names.
- [x] #50 — Attachment-only multipart messages return empty display text and no EBP extraction; multipart syntax is never a text fallback. Shared and mobile MIME tests pass.
- [x] #51 — File/mail routes have an explicit expanded-file budget while control routes retain 512 KiB. The GUI reader accepts a 25 MiB Base64 file representation and still rejects oversized control requests.
- [x] #52 — Certificate paths derive from content SHA-256 and use atomic writes. The mobile regression saves distinct certificates with a frozen timestamp and deduplicates identical content.
- [x] #53 — Single- and multi-recipient mobile mail pass includePublicKeys into outer payload construction. Actual serialization tests verify embedded sender keys are absent/present for both settings.
- [x] #54 — PostgreSQL reconnects for future calls but does not replay an operation after obtaining a client, including COMMIT response loss. Fault-injected statement and transaction tests observe one write and preserve the original error.
- [x] #55 — A keyed queue spans each complete mobile account save/upsert/select/delete; config and vault writes are atomic. Twenty concurrent account updates and selection/deletion regressions preserve acknowledged records.
- [x] #56 — Overall timeout aborts the active socket and blocks later phases/progress. A deferred mobile regression closes IMAP and observes no later SMTP authentication.
- [x] #57 — Tauri 2 path/window APIs replaced removed v1 APIs; Rust and Linux SDK requirements documented and CI added. Cargo check passed for Windows GNU with the locked dependencies and an actual Deno-compiled Windows backend sidecar; native Linux packaging is delegated to the new Linux CI gate.
- [x] #58 — Native attachment helpers call object-level file-envelope helpers, avoiding serialization/reparse delegation. Native, Python, sanitizer, and interoperability suites exercise the unchanged wire format.
- [x] #59 — Native recipient deduplication uses a Jansson hash object and retains first-seen order. Native signed multi-recipient, allocation-failure, and interoperability tests pass.
- [x] #60 — Shared server policy is enforced at settings read/write, overrides, and request URL construction across clients. HTTPS/loopback acceptance and unsafe scheme/credential rejection tests pass.
- [x] #61 — A durable nonce high-water mark is consumed atomically with identity mutations across detail, signup, payment create/recover, and resend; reserved authorization paths cannot become public details. Concurrent/replayed proof regressions and existing atomicity tests pass.
- [x] #62 — Unauthenticated legacy state is rejected explicitly; strict authenticated reads, atomic writes, exclusive key creation, and locked updates prevent downgrade/torn replacement. CLI downgrade, tampering, and four-process update tests pass.
- [x] #63 — Current clients request summary views that omit proofs in SQL; exact indexed verified-email lookup returns at most two active matches with a bounded old-server fallback. Server projection/ambiguity tests and one-call lookup contracts pass.
- [x] #64 — The 1,900-line test handler is replaced by a reexport of the production dispatcher. Main GUI fixtures now initialize Host/CSRF and exact signing confirmations and exercise production behavior.
- [x] #65 — Cardano verification requires valid_contract=true and excludes collateral-return outputs. Confirmed/failed-script/collateral regressions and payment flow tests pass.
- [x] #66 — Resends require a fresh owner-signed authorization, consume its nonce, preserve active tokens, and share an atomic per-detail cooldown and per-recipient daily budget with automatic issuance. Unauthorized/replayed/concurrent requests and token-stability regressions pass; clients persist their proof nonce.

## Related observations and explicit boundaries

- N1–N12, N14, and N16 are addressed in their corresponding production paths above. N13 is covered by the desktop compiler/CI gate; N15's checkout wiki page now documents wallet submission and recovery; N17's serialization regression is covered by both single- and multi-recipient tests.
- Existing aliases and JSON file formats remain supported. Desktop shared-store locks never steal a stale lock: a crashed writer leaves an explicit error until an operator establishes the writer has stopped and removes the `.lock` directory.
- Mobile queues serialize a process's complete mutations and atomic replacement protects each file. Configuration and encrypted credentials remain separate files; this work does not claim crash-atomic multi-file commits.
- #45 uses the reviews' immediate containment option. A purpose/version-tagged structured signature format and binary inner file format remain coordinated future migrations; verification does not fall back to arbitrary ambiguous legacy salts.
- Automatic verification issuance and signed resends share a 15-minute detail cooldown, keep a live token valid until expiry, and permit at most three issuances per normalized recipient per 24-hour budget window. Pending/budget-limited requests do not claim delivery succeeded.
- Payment reservations remain active through graceUntil so delayed wallet approvals can submit a hash. The UI requires a live quote to start a send; grace is recovery capacity, not an indefinite price quote.
- CI now covers core/CLI/GUI/server, mobile, PostgreSQL atomicity/payment contracts, and the actual desktop sidecar plus Cargo check. Device mail/TLS interoperability, real wallet broadcasts, production database outages, FTP deployments, and release signing remain release/environment validation, with no live effects performed here.

## Verification results (2026-11-16)

Tools used: Node 24.22.1, Deno 2.9.6, PostgreSQL 16 in an isolated disposable Docker container, Rust 1.93.1, and a locally built OpenSSL 3.5.7 for the native tests. Downloaded toolchains and generated executables remain outside the source diff.

| Gate | Result and scope |
| --- | --- |
| `npm run test:review-contracts` | Passed: original #1–#4 corrected-behavior checks, checkout stale-quote/uncertain-send/CIP-30 contracts, and two fake-FTP tests covering existing and missing preview destinations. |
| `deno task test:gui-backend` | Full suite passed: **109 tests** against production routes, including the real mail parser worker, vault failures, concurrent proposals, and route-specific file capacity. A later focused run also passed the added transient-read vault assertion. |
| Mobile Jest | Full suite passed: **46 suites, 267 tests**, including lifecycle cancellation, contacts I/O, certificate storage, serialized mail preferences, outbound MIME, and actual file-signature verification. |
| PostgreSQL contracts | **14 tests passed** against PostgreSQL: new remediation contracts, existing state atomicity cases, and payment uniqueness/claims. The temporary database/container was removed afterward. Lost-COMMIT-response behavior is fault-injected; a real network outage was not induced. |
| SQLite server | Broad run: **135 passed, 3 failed, 3 PostgreSQL-only cases ignored**. All three failures were fixtures loaded before their updates (old quote expiry assumptions and unsigned resend). Corrected payment/handler paths passed **5/5**; the corrected opaque-email resend/verification case passed **1/1**. Additional focused graph, identity-mutation, and directory tests passed **12** with one optional PostgreSQL migration case ignored. New SQLite remediation contracts passed **6/6**. |
| CLI | Broad run: **39 passed with 6 steps, 4 fixture failures**. The failures expected whole-directory corruption propagation, omitted the required payload version, or used cleartext non-loopback server URLs. Corrected contact/state fixtures passed **18/18**, including every failed case. The final production CLI remediation tests passed **6/6**, covering subprocess exit/stdout and four independent store writers. |
| Core/common/parity | Broad run: **230 passed with 4 steps, 1 fixture failure**. The failure expected a cached email to override a different current hash. After correcting that fixture and adding stale/revoked-cache coverage, the affected common suites passed **17/17**. The broad run also passed mobile/website signature interoperability. |
| C/Python | Native tests and **17 Python tests passed**. Address/undefined-behavior sanitizer and fuzz checks passed; allocation-failure coverage exercised **2,829 C-core failure positions across 24 operations and 91 Jansson positions**. |
| C–TypeScript interoperability | **55 cases passed** in the broad run; one new empty-attachment assertion initially compared an omitted optional JSON field with an in-memory undefined field. Correcting the assertion to compare serialized wire values yielded **1/1 passed** on that case, with no production change. |
| Website | Bundle freshness check passed. Chromium verified a real C-signed message and rejected tampering using the local verifier bundle. |
| Desktop | The backend sidecar compiled successfully with Deno. `cargo check --locked --target x86_64-pc-windows-gnu --manifest-path desktop/src-tauri/Cargo.toml` passed with a real Windows sidecar and the pinned toolchain. Native Linux packaging and platform launch/signing remain environment-specific checks; CI now checks Linux compilation with WebKitGTK 4.1. |
| Static checks | Deno type checks passed for server, production GUI routes, and CLI; build-script lint and `git diff --check` passed. |

The initial broad-run failures are reported above rather than presenting those historical runs as green. Every reported failed case was corrected and rerun successfully. The full mobile standalone TypeScript check still reports JSX, shared dependency-resolution, and runtime-global typing errors in the current checkout; it is not reported as a passing gate. Mobile validation here uses the repository's Jest pipeline and shared Deno contracts. Full device builds were not performed.
