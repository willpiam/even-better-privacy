# Holistic issue review

Review date: 2026-11-16. Repository baseline: `f6a89e66f0e3d20a116edc47ff8e04383816c548`.

## Scope and interpretation

This review covers all 66 entries in [issues.json](issues.json), the implementation paths they describe, relevant shared helpers, selected tests, and relevant Git/audit history. It identifies relationships and proposes work; it does not change issue records or implement fixes. Issue numbers below refer to that local tracker, not GitHub.

**Main finding:** the backlog is better understood as several missing system contracts than as 66 unrelated defects. The strongest common themes are validation that is optional at client boundaries, storage helpers with incomplete consistency guarantees, protocol handling that discards structure too early, and asynchronous operations whose effects outlive the state presented to the caller. These are proposed parent work items, not newly proven individual vulnerabilities.

Evidence levels used here:

- **Confirmed structural relationship:** current code shows a shared helper, dependency, or repeated mechanism. This does not mean every proposed joint fix has been implemented or tested.
- **Related invariant:** implementations violate the same rule but require separate changes.
- **Hypothesis:** a possible operational interaction or historical explanation requiring further evidence.

I read every issue description. Current-source inspection concentrated on the relationships below; this was not a fresh exhaustive audit of every implementation. I reran `node issue_tracker/review_checks.mjs` with Node v24.22.1: all four recorded reproductions (#1–#4) confirmed the existing flaws. Those passing checks assert buggy behavior, not successful fixes. Other executable evidence remains the evidence recorded in each issue; I did not independently rerun all 66 reproductions. Deno and Cargo were unavailable on PATH, and no device, live mail, wallet, chain, deployment, or PostgreSQL outage was exercised.

## Relationship map and closure rules

| Proposed parent | Children / related findings | What a joint fix can resolve | What remains separate |
| --- | --- | --- | --- |
| P1: Structured mail processing from bytes to presentation | #1–#5, #7, #9, #25–#26, #37, #46–#50 | A shared header parser can resolve #1/#5/#7; a correct MIME body-selection policy can resolve #26/#50 | Charset, address grammar, IMAP framing, SMTP replies, and transport capabilities each need explicit behavior |
| P2: Validated identity and payload boundaries | #12, #30–#31, #40–#45, #53, #60, #62 | Validated public-identity import can address #43/#44; a common payload gateway can address #41/#42 | Signature framing #45, exit behavior #40, claim refresh #12, metadata #30, settings #53/#60/#62 remain distinct obligations |
| P3: Local repositories with explicit durability and concurrency | #13, #16–#19, #52, #55 | Transactional update APIs can resolve #16/#55; resilient contact reads plus atomic writes address different halves of #13 | Path containment #17, failed-vault reads #18, session-only semantics #19, unique certificate keys #52 |
| P4: Operation lifetime and uncertain outcomes | #21–#22, #24, #29, #54, #56 | Shared design rules and fault fixtures prevent repeated mistakes | Different domains need different cancellation, recovery, and idempotency mechanisms |
| P5: Payment authorization, verification, and reconciliation | #10–#11, #21–#23, #61, #65 | Extracting a reconciliation service can resolve #10/#11 together | Wallet lifecycle, nonce scope, UTxO selection, and ledger evidence are independent correctness boundaries |
| P6: Bounded data movement and suitable data structures | #5–#6, #10, #14, #20, #34–#36, #39, #51, #58–#59, #63 | One contact snapshot/update API can resolve #34/#35; projected detail hydration can address #36 and support #63 | Encoding, body limits, native copies, graph queries, and deduplication remain separate implementations |
| P7: Production-path and cross-client assurance | #9, #30, #38–#44, #48–#49, #53, #57, #60, #64 | Replacing the forked test handler addresses #64 and improves confidence in later fixes | Tests expose defects; they do not fix their production implementations |
| P8: Deployment target and preview semantics | #32–#33 | A plan/apply split with validated destinations can resolve both | Canonical target validation and zero-mutation preview require separate assertions |
| P9: Verification-mail issuance as an abuse-resistant state machine | #66; related #12/#30/#61 | Atomic issuance policy can address token churn and cooldown races | Contact trust and payment proof replay are separate, despite all involving identity details |
| P10: Exact deterministic derivation inputs | #27–#29 | A canonical derivation-request representation can address #27/#28 | Discovery error classification #29 needs its own recovery behavior |

Parents overlap deliberately. These are relationships, not a partition and not duplicate declarations. No finding should be closed merely because a parent refactor merged.

## 1. Mail: preserve structure until the layer that understands it

### Header parsing is a genuine joint-fix opportunity

[`imapFetchBody.ts`](../mobile/src/services/mail/imapFetchBody.ts) normalizes the entire source inside `rfc822HeaderBlock`, and `messageDetailFromRfc822` calls `parseHeaderField` four times. Its `\\s*` field regex crosses a line boundary. [`mime.ts`](../mobile/src/services/mail/mime.ts) independently normalizes and unfolds headers with different rules.

This directly connects #1, #5, and #7. Extract the header block once, parse it once into a representation that preserves repeated fields and order, and have display and MIME logic use it. Acceptance must include empty headers, folded headers, duplicate fields, accepted line endings, and a large body that is not repeatedly normalized. Merely moving the existing regex into a shared file solves none of those behaviors. Merely correcting `\\s*` solves #1 but leaves #5/#7.

### MIME needs an entity model, not a larger collection of fallbacks

In `collectFromEntity`, text leaves become body candidates without checking disposition (#26). When no text leaf is found, `extractTextFromMimeSource` decodes the top-level body regardless of whether it is multipart (#50). A single policy—body text comes from eligible MIME entities, and multipart framing is never body text—can resolve both. However, simply excluding text attachments will make more messages enter the existing bad fallback. Fix these two together.

Quoted boundary parsing (#25) and charset decoding (#3) are other missing pieces of that model, not duplicates. Fixing boundary extraction can expose previously hidden leaves to the attachment-selection bug. Preserve nesting/part limits while replacing traversal.

#3 and GUI #37 violate a shared byte-preservation invariant by different mechanisms. Mobile transfer decoding returns UTF-8 text before applying a declared charset; GUI [`mail-imap.ts`](../gui/local-backend/mail-imap.ts) converts incoming bytes to UTF-8 before its charset-aware worker sees them. Adopting the GUI parser on mobile would not automatically solve either adapter's input handling. The pipeline should be raw octets → entity structure → transfer-decoded bytes → charset-decoded text → display/body policy. A shared byte-oriented corpus should include raw Latin-1 8bit, Base64 and quoted-printable, not just ASCII-encoded bodies.

### Grammar and state machines matter beyond MIME

- #9 reads a valid quoted recipient by splitting at commas; #49 writes a display name without quoting its comma. A mailbox parser/formatter with round-trip tests could resolve both, but they are different directions and different functions. Test quoted commas, escaping, Unicode names, and multiple recipients. This is a shared grammar problem, not the same bug as #1.
- #2 treats text containing ` OK` as status; #4 waits for one expected SMTP code rather than recognizing a completed reply and classifying it. Both need explicit reply parsing. An IMAP fix does not resolve SMTP, and an SMTP reply fix does not cancel timed-out work (#56).
- #46 cannot be repaired reliably in the single-line LIST parser alone: the caller must associate literal octets with the response record. #47 requires encoding/capability policy for rev1 search. #48 requires outbound header/body encoding and SMTP extension handling; it is not fixed by incoming charset support.

**Options:** targeted parser patches have the smallest immediate rollout and should address high-impact #4 promptly, but preserve the maintenance burden. A byte-oriented mail adapter with a supported MIME/address library reduces the grammar surface but adds runtime/bundle/React Native compatibility work. Replacing the whole mail stack may reduce long-term protocol ownership, but requires a device feasibility spike, capability/TLS review, and compatibility tests. The installed desktop `mailparser`/`imapflow` packages are evidence of available desktop approaches, not proof they run on mobile.

## 2. Trust: cryptographic validity is only one part of acceptance

[`verifyFileSignature`](../mobile/src/services/signVerify.ts) passes supplied keys to the verifier and displays the supplied fingerprint (#44). [`normalizeExternalIdentity`](../mobile/src/services/contactsLogic.ts) only requires nonempty fingerprint/key strings (#43). The shared core signature primitive verifies a key's signature; callers must establish that the advertised identity belongs to those keys.

A pure public-identity validator should check encodings, key types/variants, derived fingerprint, and applicable outer/embedded identity consistency. Require its result at both import and signed-file verification. Fixing import alone does not fix #44, since a file can bring its own embedded identity. Conversely, fixing #44 leaves invalid contacts persisted. Treat them as siblings under a validated-identity boundary, not one duplicate issue.

#12 and #30 concern the *state attached to* an identity. In [`contacts.ts`](../gui/local-backend/contacts.ts), cached opaque resolutions survive when the path merely remains present. [`MailAuthenticity.ts`](../common/MailAuthenticity.ts) trusts that cached cleartext before comparing the current opaque hash. Bind derived cache entries to fingerprint, claim path, and claim value/hash; invalidate on change and revalidate at consumption. A refresh-only fix leaves previously stale stored caches usable. #30 separately drops endorsement/revocation metadata during CLI projection; preserve validated remote state while distinguishing it from user-local annotations. Do not make server endorsement equivalent to cryptographic identity validation.

A possible interaction is that stale claim resolution and metadata-dropping refreshes produce inconsistent recipient/authenticity decisions depending on the last client to write a shared contact. Both mechanisms are demonstrated individually; the exact combined user journey has not been reproduced. Test a GUI → CLI → GUI refresh sequence, changed opaque claims, revoked claims, and missing metadata as *unknown*, not implicitly verified.

[`PayloadInput.ts`](../core/PayloadInput.ts) already specifies current type/version pairs, but CLI commands bypass it (#41), while mobile emergency export omits a required version (#42). Shared factories and validated ingestion can resolve this interoperability pair. Preserve the current explicit exception for an unversioned `ebp-signed-file`; do not invent a universal version requirement inconsistent with today's format. #15 is another writer/reader contract mismatch: empty attachment data is valid on creation but rejected on parsing. An empty-file round-trip belongs in the same cross-client corpus, even though its fix is separate.

#40 needs a command policy: failed authentication must yield nonzero status and avoid ordinary authenticated stdout; explicit unverified recovery output could be a separate opt-in. Stricter envelope parsing does not change that exit behavior.

#45 is deeper: [`buildFileSignMessage`](../core/CryptoUtils.ts) concatenates salt/context with `::`, allowing two field tuples to share signed bytes. A shared validator cannot make an ambiguous serialization injective. Immediate containment can restrict the salt to the generated canonical syntax at every verifier; a durable fix is a purpose/version-tagged canonical structured message or length-prefixed fields. That changes signed bytes, so coordinate producers/verifiers across mobile, GUI, website and any native consumers. If old verification remains, expose a bounded explicit compatibility policy; silently trying the old ambiguous encoding preserves the attack.

#31 is a distinct presentation boundary: valid remote detail strings are still untrusted terminal content. Escape control characters at CLI output, preserving readable values and keeping structured output semantics explicit. Rejecting all such strings on the server would alter the public detail contract and would not protect against an untrusted server. Identity validation, HTML escaping and signature verification do not sanitize terminal sequences. Test captured output rather than emitting controls into a real terminal.

#53 is an independent serialization-policy failure: an include-keys preference changes prose rather than builder arguments. Test the produced outer payload, not just its introductory text.

**Recommended approach:** centralize small pure validators/builders, retain platform I/O adapters, and use the same positive and negative fixtures across implementations. A complete single runtime or native-core rewrite is much larger and can reproduce adapter mistakes. Sharing code improves consistency only if its contract is correct; #9 already demonstrates identical implementations passing incomplete fixtures.

## 3. Local storage: atomic replacement is not a transaction

#16 and #55 use the same read → modify → replace pattern on different whole-file stores. Two callers can report success while one update disappears. A keyed queue spanning the *entire* update addresses a single process; a queue around only the final write does not. The repository already has [`KeyedQueue`](../common/KeyedQueue.ts), used for identity mutations, and [`writePrivateFileAtomic`](../cli/atomic-file.ts). Reuse these patterns with platform-specific atomic replacement rather than inventing another partial helper.

Queues are process-local. CLI and GUI intentionally share desktop data, so multi-process writers need a file lock with a defined recovery policy or a transactional database. Atomic rename prevents partial content but does not prevent lost updates; locking prevents overlap but does not prevent torn replacement after a crash. Mobile account updates also touch configuration and secrets: after fixing #55, examine consistency across both stores rather than assuming one queued JSON file makes the overall operation transactional.

#52 loses records through timestamp-key collisions, not read-modify-write. Use a content-derived or unique certificate key with explicit duplicate semantics and collision-safe creation. Serializing saves alone still permits the same timestamp to be reused.

#13 and #18 show opposite unsafe error policies:

- Contact enumeration lets one damaged record abort all healthy records. Isolate per-entry errors, return healthy entries plus diagnostics, and retain damaged data for recovery. Add atomic writes to reduce future truncation, but that cannot repair existing malformed files or other read failures.
- Vault reads turn every failure into absence, then cache/write an empty-derived store. Return distinct missing, corrupt, unavailable, and valid states; only confirmed absence may initialize a vault. Never save after an unsuccessful read/unlock. Atomic writes alone do not fix this destructive interpretation.

#19 needs separate session and persisted secret projections. Cache the full active session map; serialize only entries approved for persistence. Saving to disk and updating the live cache must not use a filtered object as if it represented all available credentials. A transactional storage migration alone would preserve the wrong semantics.

#17 is an independent containment boundary: validate aliases on every read/write/delete path and resolve paths within the contacts directory. Fingerprint validation is not filename validation. Prefer internal stable IDs with aliases stored as data. Consider traversal/symlink behavior appropriate to the supported filesystems; a string prefix check alone is not a complete containment policy.

**Options and consequences:** extending existing queues/atomic writers is incremental and keeps JSON interoperability, but requires explicit cross-process handling. SQLite or another transactional local repository simplifies uniqueness and multi-record updates, but adds mobile dependencies, migration/export/recovery work and coordination with CLI/GUI. Adopt it only after defining semantics; moving ambiguous errors or unsafe alias-derived paths into a repository does not automatically fix them.

## 4. Asynchrony: missing, failed, cancelled and unknown are different states

#21 and #54 are a strong conceptual relationship across unrelated domains. [`payEthereum`](../website/checkout.js) resends after almost any wallet error; [`PostgresDatabaseAdapter.withClient`](../server/db/postgres.ts) reruns the supplied operation after a transient connection error. Neither proves the previous write had no effect.

For wallets, restrict compatibility fallback to errors known to precede broadcast, prefer a supported request shape before sending, and provide an unknown-outcome recovery path. For databases, separate reconnecting from replaying; retry safe reads or explicitly idempotent commands, and reconcile writes by durable operation key. A uniqueness error on replay may mean the first insert succeeded, not that another buyer took an address. A transaction is not sufficient when COMMIT's response is lost. Removing retries reduces duplicate effects but exposes more transient failures; idempotent recovery costs schema/API work and offers the strongest eventual user experience.

#22 adds a temporal payment contract. Refresh/validate the quote before asking the wallet, check expiry again after long user approval, and define what happens if broadcast beats the expiry but submission does not. A frontend clock check alone cannot guarantee this. A server reservation/grace/recovery policy can prevent orphan payments but changes inventory/entitlement rules and must resist indefinite reservations. Fixing blind retries does not fix stale quotes.

#24 and #56 both allow work to complete after the UI has declared a terminal state. The mobile unlock cache awaits preferences and later installs the key without checking a lock generation. The mail-test timeout rejects its wrapper but leaves the underlying IMAP/SMTP sequence running. Use operation generations for pending unlocks and invalidation on lock; wipe rejected derived keys where ownership permits. Propagate cancellation to active sockets and check before subsequent authentication phases. `Promise.race` or ignoring the late result is not cancellation. These can share lifecycle conventions and deferred-promise tests, not one literal cancellation implementation.

#29 converts HTTP failures into unused derivation slots. #18 converts storage failure into no vault. Both need typed results, but the recovery policy differs: discovery should count only authoritative absence toward its gap, distinguish 429/503, and report incomplete scans/checkpoints. Do not skip outages and present success.

## 5. Payments: separate orchestration from transport and evidence

#10 and #11 have a confirmed common implementation cause. [`reconcilePendingPayments`](../server/handlers/mail-payment.ts) constructs fake HTTP requests to call `handlePaymentOrder`. Each call repeats global expiry, then the worker reduces domain failures to status codes and cancels their bodies.

Extract a per-order reconciliation service with typed outcomes and contextual errors, called by both HTTP and worker adapters. Run expiry once per batch while retaining an appropriate expiry path for standalone requests. Include order ID, stage, retryability and safe provider error context in worker logs. This can address #10/#11 together. Passing a skip-expiry flag and reading the HTTP body is a smaller patch, but preserves transport coupling and makes consistency easier to break later. Neither option fixes wallet or ledger verification defects.

#23 is a client/server resource contract mismatch: the wallet sends every UTxO; the endpoint rejects more than 40 before selection. Keep a resource bound and implement bounded selection/pagination consistent with CIP-30 wallet support. Selecting the first 40 blindly may miss sufficient value or suitable assets; expanding the server cap without a budget increases work. Acceptance needs a funded fragmented wallet, insufficient bounded subsets, and unsigned transaction construction—not just synthetic UTxO counts.

#61 reveals a split replay domain. [`ensureNewNonce`](../server/db/index.ts) reads only detail nonces, while checkout signs a detail proof and stores its nonce on a payment order. Local counter increments and the payment table's unique index do not establish a global accepted-proof boundary. Options:

1. Keep a shared nonce domain: reserve a per-identity high-water mark atomically with each accepted command across both workflows. This preserves monotonic semantics but requires every writer to participate and careful rollout/initialization.
2. Introduce purpose-separated payment authorizations with independent replay records. This isolates payment from public detail semantics but changes the protocol/client format and requires explicit rejection of payment proofs at the detail endpoint.

Computing a maximum across two tables without atomic reservation still races. Simply banning the payment path in public details is useful containment but does not solve reused counters for other paths. Signature validity and nonce freshness are separate checks; the existing recorded reproduction did not exercise the entire signed HTTP path.

#65 is an immediate high-impact verifier concern, separate from wallet usability. [`checkCardanoPayment`](../server/payments/verification.ts) models outputs without collateral semantics and sums all matching addresses. The provider adapter discards no collateral evidence. Normalize provider responses into evidence of outputs actually created by the ledger, with transaction validity and collateral flags explicitly modeled. A containment policy could reject script/collateral cases until supported, at the cost of rejecting legitimate payments; full semantics support needs real documented fixtures and integration evidence. Filter the successful-transaction case promptly, but do not assume that alone defines phase-2-invalid behavior. Test the external transaction-hash submission path too: correcting the built-in wallet's transaction builder cannot constrain a payer's externally constructed transaction.

## 6. Verification mail: ownership and abuse limits belong in issuance

#66 concerns an unauthenticated state-changing resend using public identity data. [`issueDetailVerification`](../server/db/index.ts) replaces outstanding token state; `verification_sent_at` is written without enforcing a cooldown. Existing atomicity prevents some races but does not authorize issuance or prevent token churn.

Require suitable owner authorization for explicit resends, enforce an atomic per-detail cooldown, and add recipient-wide budgets so many attacker identities cannot bypass the bound. Keep an unexpired outstanding token valid according to an explicit resend policy. An IP limit alone does not prevent distributed abuse; owner signatures alone do not prevent attacker-owned identities from mailing a victim. Avoid retaining plaintext tokens merely to resend them; decide whether to suppress resends during validity or support a carefully designed multiple-token policy. Include automatic email triggered by detail creation in the same budget.

This shares identity-detail lifecycle concerns with #12/#30 and authorization concerns with #61, but none of those fixes resolves #66. Test concurrent requests, token stability, expiry, clear/opaque email paths, many identities targeting one address, and failed delivery. The current handler also catches send failure and returns `sent`; that source-observed behavior is worth clarifying in the issuance design, not a newly reproduced tracker finding.

## 7. Efficiency: reduce repeated work before increasing limits

These findings share an architectural tendency to call a convenient high-level helper in a loop or pass full objects where a projection suffices. They are not one performance bug, and the issue measurements are operation counts/source evidence rather than universal speedups.

| Findings | Intervention | Consequences / acceptance |
| --- | --- | --- |
| #34/#35 | Resolve from one contact snapshot and pass the matched record/path to cache persistence | Removes redundant and nested full scans; update cache safely under P3 and validate claim binding under P2. Do not introduce a stale global index without invalidation |
| #36 | Fetch detail rows once and derive values, metadata and revoked paths together | Reduces queries and supports a consistent response snapshot; retain all revocation/verification semantics |
| #63 | Dedicated directory/search summary projection, fetching proofs only when needed | Less transfer; audit consumers and avoid treating an unsigned summary as cryptographic evidence. Separate endpoint/version may preserve old consumers |
| #20 | Query graph endpoints rather than full signatures; consider only relevant graph components | Reduces work inside serialized transactions; preserve atomic cycle/parent checks, including proposed connections between components |
| #39/#59 | Set/hash membership with stable output ordering where required | Removes quadratic deduplication; layout BFS bug #38 is separate and still needs fixing |
| #6/#8 | Validation-only JSON traversal, explicit scanner states and cursor invariants | Avoid discarded canonical copies while retaining duplicate escaped-key checks, Unicode scalar rules, NUL-name checks and finite-number rejection |
| #14/#58 | Efficient byte Base64 encoding; native object-level helpers rather than serialize/parse bridges | Reduces transient copies without changing format; test all supported engines/native bindings, empty bytes and large inputs |
| #51 | Route-specific bounded file transport with encoded/encrypted size budgets | Restores file contract while preserving resource control; raising the global cap increases exposure and can amplify #14/#6/#58 |

The #51/#14/#6 relationship is especially actionable: fixing the premature 512 KiB rejection permits much larger payloads to reach already expensive allocation paths. Optimize and bound those paths before broadly raising capacity. For a 25 MiB file, Base64 alone is 34,952,536 characters before JSON and envelope overhead; encrypted/nested forms need their own budget. Binary or streaming transport can avoid some expansion but requires transport and possibly envelope redesign; it does not automatically make whole-buffer cryptography streaming.

#38/#39 share the hierarchy layout function but different causes. GUI seeds all nodes at depth zero before BFS; mobile performs BFS first. Share a corrected pure layout or run identical fixtures through both, then independently replace sibling membership scans. Current mobile production UI use of the layout remains unestablished by the issue evidence; do not claim a mobile rendering outage from #39 alone.

## 8. Derivation and recovery: accepted input must mean the derived identity

#27 discards accepted hardening information when reconstructing a path; #28 truncates malformed numeric strings with `parseInt`. Introduce a canonical derivation-request type with full-string numeric validation and explicit allowed path shapes. Either derive exactly the accepted path or reject unsupported hardening before key generation. Rejecting unsupported paths is the smaller change; supporting arbitrary paths expands provenance/recovery/UI obligations. Do not silently rewrite existing provenance or identities. Test that recorded path, actual key derivation and recovery agree for fixed seeds, plus negative inputs such as `1e3`, `3.9`, and unsupported hardened segments.

#29 belongs in the same recovery workstream but remains a server-result classification defect. Input validation cannot prevent an outage from falsely consuming the discovery gap.

## 9. Deployment: plan first, mutate only during apply

#32 and #33 share [`deploy_ftp.py`](../scripts/deploy_ftp.py), but fixing one does not close the other. `require_remote_dir` counts unnormalized segments; `connect` calls a directory helper that creates missing paths before dry-run branches.

Reject dot segments or canonicalize and enforce the intended non-root boundary; do not silently reinterpret a dangerous operator destination. Account for the FTP server's actual working directory semantics and permissions. Split connection/read-only inventory from directory creation, upload and pruning. An explicit immutable plan with a single apply stage makes dry-run behavior auditable. Test a fake FTP command log containing no `MKD`, `STOR`, `DELE`, or other mutations in preview, both missing and existing destinations. Test `/site/..` and equivalent roots before any destructive command. Restricting FTP account scope is useful defense in depth, not a replacement for either fix.

## 10. Earlier decisions worth reconsidering

These observations concern documented code/history, not the intentions of earlier authors.

| Earlier decision / evidence | Current consequence | Reconsideration |
| --- | --- | --- |
| Shared logic separated into `common/`; GUI mirrors explicitly documented in `ComposeRecipients.ts`; commit `3cda855` | Identical recipient bugs (#9), layout divergence (#38), incomplete parity coverage | Generate/browser-bundle pure logic where feasible; otherwise require a common adversarial corpus against every mirror |
| Identity queues/atomic writes added in `f6c86e4`; storage/authentication/routing work in `4dbb957` | Equivalent guarantees do not cover all contact/account/proposal stores (#13/#16/#18/#52/#55) | Inventory all mutable stores and declare guarantees per store, rather than treating “atomic storage” as a repository-wide property |
| `4dbb957` split production backend routing; `tests/test_handler.ts` remains its own implementation | #64: the major suite tests different behavior | Inject dependencies into real production entrypoints and retire the route copy; the existing real `route_dispatch_test.ts` shows this is feasible |
| Historical F-GUI-08 added a request cap | #51: cap conflicts with supported file sizes | Preserve boundedness but derive endpoint budgets from representations and operation limits |
| F-CLI-03 hardened CLI URLs; F-STORAGE-10 added state MACs | #60 other setters accept HTTP; #62 unversioned state bypasses MAC | Apply URL policy at shared ingestion/use boundaries; make legacy state recovery explicit and one-way rather than an implicit authentication downgrade |
| F-CRYPTO-07 fixed ambiguous hierarchy signing; current file signing still joins fields | #45: same class of framing failure in a different format | Inventory every signed-byte constructor; use purpose-tagged injective encoding with cross-client vectors |
| F-DEP-02 migrated Tauri dependencies | #57: application still calls removed API | Require a real compile/package smoke test alongside dependency/security checks; this does not reopen the original dependency vulnerability |
| Checkout compatibility fallback and DB connection recovery repeat operations | #21/#54 unknown outcomes become retries | Make retryability part of each operation's contract, with durable recovery identity for side effects |
| Legacy cleanup `44df197` and current `docs/legacy-inventory.md` state unsupported formats are rejected | #41/#42/#62 expose uneven enforcement | Audit all public readers/writers against explicit exceptions; documentation and current validators must agree |

Older architecture notes are leads, not authoritative current descriptions. For example, [application complexity debt](../wiki/analysis-application-complexity-debt.md) describes a monolithic backend and a tiny canonical-JSON shim, while current production routes are split and `CanonicalJson.ts` implements substantive validation/serialization. Do not schedule those old refactors verbatim. The more current problem is consistent use of the resulting boundaries.

## 11. Practical sequence and verification gates

1. **Contain concrete security/data-loss failures.** Prioritize #65, #44/#45, #12, #18 and #24 according to enabled deployment paths; address #66 abuse, #17 containment, and #32 destructive deployment before affected operations are exposed. Preserve the tracker severities; this is a remediation order, not a new quantitative risk score. Keep testnet-only limits on #21/#22 explicit.
2. **Make tests exercise production.** Address #64 early and add negative interoperability fixtures before relying on broad green suites. Fix #57 with a real Tauri build when the toolchain is available. This improves assurance without blocking urgent narrowly tested containment.
3. **Stabilize storage and operation lifecycle.** Implement P3/P4 contracts, including cross-process scope, unknown outcomes and lock/cancellation generations. Exercise overlapping requests, failed reads, response loss after commit, and late completions—not timing-dependent sleeps.
4. **Consolidate mail and validated payload boundaries incrementally.** First combine #1/#5/#7 and #26/#50; then byte/charset handling, mailbox grammar, IMAP framing, SMTP capability policy. Keep malformed-input and resource limits. Complete P2 across every ingress, not only one screen.
5. **Extract payment domain service and authorization policy.** Resolve #10/#11, #61, quote recovery and bounded UTxO selection as separate acceptance gates. Use normalized provider fixtures and external-hash tests for #65.
6. **Optimize and restore capacity.** Address contact scans and file allocations before widening file budgets, then query projections and native/graph deduplication. Measure realistic engine/device/database behavior before promising speedups.

Minimum regression groups should include:

- Cross-client round trips and negative cases for all current payload families, including #15/#41/#42/#43/#44/#45/#53/#60; actual producer → actual consumer, not duplicate fixture expectations alone.
- Contact refresh across clients preserving metadata and invalidating only claim-dependent caches; corrupted neighbor records and old stale cache files.
- Storage operation schedules that force simultaneous reads, failed replacements and duplicate timestamps; retain both acknowledged records or return an explicit failure.
- Mail fixtures for empty/folded headers, quoted boundary spaces, explicit text attachments, attachment-only messages, raw non-UTF-8 bytes, quoted address commas, literal LIST names, non-ASCII rev1 search and limited EHLO capabilities.
- Real route tests for signing confirmation and email issuance, plus stateful provider/database fault tests that distinguish known failure from unknown commit/broadcast.
- Resource assertions on reads, queries, copies and membership operations, with separate end-to-end latency/memory measurements where useful.

## 12. Coverage ledger and remaining questions

All tracker entries are represented: #1–#5/#7/#9/#25–#26/#37/#46–#50 in mail; #6/#8/#14/#20/#34–#36/#39/#51/#58–#59/#63 in efficiency; #10–#11/#21–#23/#61/#65 in payments; #12/#30/#31/#40–#45/#53/#60/#62 in trust; #13/#16–#19/#52/#55 in storage; #24/#29/#54/#56 in operation lifetime; #27–#29 in derivation; #32–#33 in deployment; #38/#57/#64 in assurance/history; #15 in payload round trips; #66 in issuance. Overlap is intentional.

Open questions that materially affect implementation choices:

- Which local stores can be written by multiple processes, and which must commit together? Confirm CLI/GUI coexistence and mobile multi-store recovery requirements before choosing locks versus a database.
- What are the exact supported mail-server versions/extensions and React Native byte/parser capabilities? Use an on-device spike before committing to a replacement library.
- What is the accepted treatment of old ambiguous file signatures and unauthenticated state files? Define explicit recovery/migration policy rather than an implicit fallback.
- Can checkout accept/recover transactions broadcast during quote expiry, and how is address inventory reserved while a wallet approval is pending?
- Which native/browser/mobile public APIs promise arbitrary-size recipient lists or 25 MiB files? Define realistic representation and memory budgets across consumers.
- Can recorded temporary reproductions for later findings be retained as production-path regressions? Many issue descriptions say their scripts were removed, limiting immediate rerun coverage.

No common parent above is a reason to erase a child issue. Close each child only with its own demonstrated behavior corrected, relevant negative tests passing against production code, and cross-client/storage/protocol consequences checked. The highest-leverage change is making those contracts enforceable at shared boundaries, while preserving precise evidence about which failures each change actually resolves.
