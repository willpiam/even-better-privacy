# Wiki Log

## [2026-06-02] update | mobile interop drift remediation

- Implemented shared `core/` modules (PayloadInput, SenderResolution, CryptoUtils,
  FilePayload builders) and wired mobile + GUI decrypt paths.
- Updated: [[analysis-gui-mobile-parity-deltas]], [[component-mobile]].

## [2026-06-02] query | GUI vs mobile parity deltas

- Answered: grouped missing GUI features (native email, EBP-HD, password policy,
  opaque details, multi-recipient, shared `~/.ebp/`) vs format drift
  (`senderIdentity`, payload `version`, salt RNG, armor, decrypt without contact).
- Filed: [[analysis-gui-mobile-parity-deltas]].

## [2026-05-26] query | encrypted signature representation

- Answered: sign-then-encrypt payloads encrypt an inner JSON string containing
  a Base64 signature string, not raw signature bytes.
- Updated: [[analysis-key-encoding-rationale]].

## [2026-05-26] query | unifying key encodings

- Answered: unifying key material encoding is primarily a compatibility and
  migration problem across KEM serialization, fingerprints, identity storage,
  server state hashes, public identity exports, and verifier/test surfaces.
- Updated: [[analysis-key-encoding-rationale]].

## [2026-05-26] query | signing vs KEM key encoding

- Answered: signing public keys/signatures are RFC 4648 Base64 while ML-KEM
  keys/ciphertexts are hex by EBP serialization convention, not cryptographic
  necessity.
- Filed: [[analysis-key-encoding-rationale]].

## [2026-05-25] change | EBP-HD reframed as ebp-hd-v1 conformance

- Updated: [[analysis-ebp-hd-bip-compliance]], [[ebp-hd]],
  [[source-bip-hd-wallet-standards]], [[analysis-bip-patterns-for-ebp]], and
  [[key-management]] to make `ebp-hd-v1` the conformance target and narrow BIP
  compatibility to BIP39-English mnemonic format.
- Updated: `docs/ebp-hd-spec.md`, `ReadMe.md`, `gui/index.html`,
  `gui/app.js`, and `cli/main.ts` with conformance/non-goal language.
- Expanded: `core/tests/fixtures/ebp-hd/test-vectors.json` and wired
  `core/Hd.test.ts` / `core/Mnemonic.test.ts` to use the canonical vectors.

## [2026-05-25] query | EBP-HD BIP compliance language

- Answered: EBP-HD should not claim broad BIP32/39/43/44 compliance; the safe
  claim is BIP39-English mnemonic-format compatibility plus BIP-inspired
  EBP-HD structure.
- Filed: [[analysis-ebp-hd-bip-compliance]].

## [2026-05-24] update | password policy documentation and GUI opt-out

- Added: [[password-policy]] (rules, enforcement surfaces, GUI opt-out, audit
  history).
- Updated: [[identity-model]], [[component-gui]], [[index.md]].
- Code: GUI Settings toggle `ebp.identity.enforcePasswordPolicy`; API
  `enforcePasswordPolicy: false` skips validation on identity create.

## [2026-05-24] change | EBP-HD BIP39 English mnemonic

- Updated: [[ebp-hd]] now documents BIP39 English mnemonic words with the
  `ebp-mnemonic-v2:` seed salt.
- Updated: [[analysis-bip-patterns-for-ebp]], [[index.md]], and the April 2026
  threat model to reflect the hard replacement of the earlier indexed EBP
  mnemonic test format.

## [2026-05-24] update | EBP-HD implementation

- Added: [[ebp-hd]] as the active concept page for deterministic hierarchical
  identities.
- Updated: [[analysis-bip-patterns-for-ebp]], [[key-management]], [[overview]],
  [[index.md]] to reflect implementation status.

## [2026-05-23] query | BIP HD patterns applied to EBP

- Answered: per-BIP (32/39/43/44) application to PQ dual-key identities,
  advantages, composition with hierarchy certificates, and open design
  questions.
- Filed: [[analysis-bip-patterns-for-ebp]].

## [2026-05-20] ingest | NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption

- Ingested `NIST Selects HQC as Fifth Algorithm for Post-Quantum Encryption.md`
  → [[source-nist-hqc-fifth-pq-encryption]].
- Updated: [[hqc]] (new), [[ml-kem]], [[source-fips-203]], [[overview]],
  [[fn-dsa]], [[cryptographic-algorithm-transitions]], [[index.md]].

## [2026-05-17] ingest | Google OAuth 2.0 web server + Cross-Account Protection (RISC)

- Ingested `Using OAuth 2.0 for Web Server Applications  _  Authorization.md` →
  [[source-google-oauth2-web-server]].
- Ingested
  `Protect user accounts with Cross-Account Protection  _  Cross-Account Protection (RISC).md`
  → [[source-google-cross-account-protection-risc]].
- Updated: [[component-server]], [[component-gui]],
  [[component-email-extension]], [[overview]], [[index.md]].

## [2026-05-13] update | shared key retirement and tooling follow-up

- Updated: [[analysis-shared-key-concept]] with pairwise retirement
  certificates, recipient acceptance semantics, and current code surface notes
  for single-recipient KEM shared secrets vs multi-recipient content keys.

## [2026-05-13] query | shared key concept

- Answered: refined shared keys as short-lived pairwise content-encryption roots
  with bech32 fingerprints, signed certificates, expiry, directionality, and a
  phased rollout path.
- Filed: [[analysis-shared-key-concept]].

## [2026-05-11] ingest | Hashcash — A Denial of Service Counter-Measure (Back, 2002)

- Ingested `hashcash.pdf` → [[source-hashcash-adam-back-2002]].
- Updated: [[hashcash-cost-functions]] (new), [[email-transport]], [[overview]],
  [[index.md]].

## [2026-05-11] ingest | RFC 4648 — Base-N encodings (Base16/32/64)

- Ingested `rfc4648.txt` → [[source-rfc-4648]].
- Updated: [[message-payload-formats]],
  [[analysis-reimplementation-building-blocks]], [[identity-model]], [[ml-dsa]],
  [[slh-dsa]], [[overview]], [[index.md]].

## [2026-05-09] ingest | Bitcoin BIP HD wallet standards (32, 39, 43, 44)

- Ingested `bip-0032.mediawiki`, `bip-0039.mediawiki`, `bip-0043.mediawiki`,
  `bip-0044.mediawiki` → [[source-bip-hd-wallet-standards]].
- Updated: [[key-management]], [[overview]], [[index.md]].

## [2026-05-07] ingest | Unverified apps — Google Cloud Platform Console Help

- Ingested `Unverified apps - Google Cloud Platform Console Help.md` →
  [[source-google-cloud-unverified-apps]].
- Updated: [[component-server]], [[component-gui]],
  [[component-email-extension]], [[index.md]].

## [2026-05-06] update | component-desktop source provenance

- Promoted [[component-desktop]] from `seed` to `active` after confirming mature
  architecture coverage and adding direct desktop implementation/build sources.
- Added direct source anchors to desktop paths and packaging scripts
  (`build_desktop_linux.sh`, `build_desktop_mac.sh`, `build_desktop_windows.sh`)
  and refreshed metadata (`last_updated`, `source_count`).
- Verified and tightened architecture statements against direct implementation
  sources, including sidecar spawn/termination behavior
  (`desktop/src-tauri/src/main.rs`) and sidecar compile pipeline
  (`scripts/build_desktop_backend_sidecar.ts`).

## [2026-05-06] query | weakest-defined architecture concepts

- Answered: ranked architecture concepts with the weakest current definition,
  with strongest gaps in FN-DSA integration details, mobile parity definition,
  and roadmap-only concepts lacking canonical pages.
- Filed: [[analysis-weakest-defined-architecture-concepts]].

## [2026-05-06] query | reimplementation building blocks checklist

- Answered: documented the crypto/encoding/runtime primitive inventory and
  deterministic mapping requirements needed to reimplement EBP in another
  language with compatible input/output behavior.
- Filed: [[analysis-reimplementation-building-blocks]].

## [2026-05-06] query | noble library usage map

- Answered: consolidated where EBP uses `@noble/post-quantum`, `@noble/hashes`,
  and `@noble/ciphers` across scheme docs, website verifier docs, and audit
  notes.
- Filed: [[analysis-noble-library-usage]].

## [2026-05-01] lint | wiki-health-check

- Orphans: 0 (fixed: 0)
- Broken wikilinks: 2 (fixed: 2)
- Stale pages: 2
- Missing pages created as seeds: 1
- Contradictions: 1 (resolved: 0)
- Frontmatter issues: 9 (fixed: 9)
- Notes: Added [[component-desktop]] for repeated desktop/Tauri coverage,
  expanded [[index.md]] to catalog required operations files and audit subpages,
  fixed malformed/root-sensitive wikilinks, refreshed
  [[security-audit-2026-04/findings]] metadata, and marked
  [[analysis-top-open-security-issues]] `needs-review` because its detailed
  prose still contains stale open-issue wording after the findings register
  closed all items.

## [2026-04-30] query | ways the application is more complicated than it needs to be (excluding mobile/email)

- Answered: identified ten complexity hotspots, grounded in both the wiki and
  code, including the 4,795-line `gui/local-backend/routes.ts`, the desktop
  sidecar's HTTP-loopback architecture, the connection-shaped DB layer, the
  1,328-line `core/Identity.ts` god class, and parallel verifier
  implementations.
- Filed: [[analysis-application-complexity-debt]].

## [2026-04-30] ingest | Long-lived digital integrity using short-lived hash functions

- Ingested `Long-lived-digital-integrity-using-short-lived-hash-functions.pdf` →
  [[source-long-lived-digital-integrity-using-short-lived-hash-functions]].
- Updated: [[integrity-renewal]], [[key-management]], [[index.md]].
- Contradictions noted: none; this source extends long-term verification
  guidance and explicitly reinforces that renewal applies to signatures.

## [2026-04-30] remediation | all remaining audit findings

- Remediated the remaining open findings in [[security-audit-2026-04/findings]],
  spanning core/storage, GUI local backend, Docker/build, Tauri desktop, and
  supply-chain/release process work.
- Added storage authentication/AAD/key-type binding, stricter hex parsing and
  hierarchy signing tests, GUI path redaction/OAuth allowlisting/static
  traversal hardening, Docker/build/release lints, JSR dependency aliases,
  bundled sidecar resolution, and runtime mail OAuth client ID provisioning.
- Added [[release-process]] and regenerated the remaining findings plot after
  the register was closed out.

## [2026-04-30] remediation | above-foo grouped findings batch

- Remediated the current findings above `foo(x)=8`: F-GUI-02, F-GUI-08,
  F-GUI-10, F-CRYPTO-04, F-CRYPTO-06, F-WEB-04, and F-TAURI-05.
- Added bounded GUI JSON body parsing, OAuth start rate/pending caps, exclusive
  save-file writes, constructor-backed identity storage loading, decoded-byte
  fingerprint leaf hashing, safer verifier JSON object validation, and `0600`
  sidecar log permissions.
- Regenerated the remaining findings plot after updating
  [[security-audit-2026-04/findings]].

## [2026-04-30] update | audit findings planning skill documentation

- Added [[analysis-address-recent-audit-findings-by-group-skill]] documenting
  the project skill that plans remediation for unresolved findings above `foo`,
  grouped by component/remediation type.
- Captured the Plan Mode hard-gate behavior and the required final workflow step
  to remove solved-item handling where applicable and rerun
  `python plot_remaining_findings.py`.
- Updated [[index.md]] under Analyses.

## [2026-04-29] remediation | at-or-above-foo findings batch

- Remediated the findings that plotted at or above `foo(x)=8`: F-WEB-03,
  F-SERVER-08, F-GUI-03, F-STORAGE-09, F-SERVER-13, F-CLI-04, F-CLI-06,
  F-STORAGE-11, and F-CRYPTO-11.
- Added targeted coverage for filename length capping, protocol-version patch
  parsing, AES/auth vs storage-format error classification, static-site CSP
  coverage, password policy validation, identity registration replay behavior,
  and documented-password test fixtures.
- Narrowed GUI Deno permissions and regenerated the remaining findings plot
  after pruning obsolete scoring patterns from `plot_remaining_findings.py`.

## [2026-04-28] remediation | above-foo findings batch

- Remediated the findings that plotted above `foo(x)=8` in
  `remaining-findings-plot.png`: F-SERVER-06/07/10/11, F-CLI-02/03/05, F-WEB-02,
  F-GUI-12, F-CRYPTO-09/10.
- Added targeted regression coverage for SQLite foreign keys, escaped SQL LIKE
  patterns, plaintext verification-token fallback, CLI server URL validation,
  GUI OAuth callback HTML escaping, encrypted-signed inner payload type tags,
  and revocation-reason length limits.
- Regenerated [[security-audit-2026-04/findings]] statuses and the remaining
  findings plot.

## [2026-04-28] remediation | F-DEP-02

- Migrated desktop shell dependencies/config from Tauri 1.x to Tauri 2.x
  baselines (`desktop/src-tauri/Cargo.toml`,
  `desktop/src-tauri/tauri.conf.json`,
  `desktop/src-tauri/capabilities/default.json`, `desktop/package.json`) and
  enabled `tauri-plugin-shell`.
- Verified with `cargo check`; dependency graph moved to Tauri 2.x, but local
  machine is missing WebKitGTK/libsoup dev packages required to complete Linux
  linking.

## [2026-04-28] remediation | F-GUI-05

- Isolated MIME parsing behind a dedicated worker
  (`gui/local-backend/mail-worker.ts`) and routed message/attachment parsing
  through `parseMailSourceInWorker` with source-size/time limits
  (`gui/local-backend/mail-imap.ts`, `gui/local-backend/routes.ts`).
- Pinned high-risk mail parser dependencies and added daily dependency
  monitoring (`package.json`, `deno.json`, `.github/dependabot.yml`).

## [2026-04-28] remediation | F-STORAGE-02

- Migrated encrypted identity blobs to Argon2id-based KDF in AES ciphertext v3
  (`core/AES.ts`, `core/version.ts`) while retaining decrypt compatibility for
  legacy v1/v2 ciphertext.
- Confirmed migration behavior via `core/tests/AES_kdf_upgrade_test.ts`.

## [2026-04-28] remediation | F-GUI-06

- Added explicit per-action signing confirmation payload validation in
  `/api/v1/sign` and wired UI confirmation flow before signing requests
  (`gui/local-backend/routes.ts`, `gui/app.js`).

## [2026-04-28] remediation | F-CRYPTO-03

- Added per-purpose signature envelope domains (`message`, `detail-proof`,
  `revocation`, `hierarchy`) in `core/MessageHash.ts`.
- Updated core/server hierarchy and revocation/detail proof flows to sign/verify
  with the new purpose-bound envelopes while retaining legacy verification
  fallback paths.

## [2026-04-28] remediation | F-CRYPTO-05

- Added canonical JSON serialization helper (`core/CanonicalJson.ts`) and moved
  signed revocation/detail/hierarchy payload generation to deterministic
  canonical encoding.

## [2026-04-28] remediation | F-SERVER-09

- Moved email-verification tokens out of query URLs into fragment-based client
  flow with POST submission (`server/verify-email.ts`).
- Updated verification page tests to assert non-reflection of token values
  (`server/tests/verify_email_xss_test.ts`).

## [2026-04-28] remediation | F-SERVER-04

- Hardened server defaults by replacing wildcard CORS defaults, adding host
  allow validation hook, and adding baseline security headers (`server/cors.ts`,
  `server/main.ts`, `server/response.ts`).

## [2026-04-28] remediation | F-TAURI-02

- Added explicit restrictive CSP to desktop webview configuration
  (`desktop/src-tauri/tauri.conf.json`).

## [2026-04-28] remediation | F-STORAGE-06

- Added regression coverage to verify emergency revocation certificates are
  exported at `0o600` (`cli/tests/perms_test.ts`), matching hardened command
  implementations.

## [2026-04-28] fix | website verifier shared-host MIME

- Renamed the browser verifier crypto module from `website/crypto.mjs` to
  `website/crypto.js` and updated `website/verify.js` to import `./crypto.js`.
- Rationale: iPage/shared hosting may serve `.mjs` with an empty or incorrect
  MIME type; browsers enforce strict MIME checking for `type="module"` scripts.
  A `.js` module avoids the hosting MIME mapping issue while preserving ESM
  semantics.
- Bumped `website/verify.html` script cache buster to `?v=8`.
- Updated [[component-website]] to document the `.js` extension choice.

## [2026-04-28] fix | website verifier noble argument order

- Fixed `website/crypto.mjs::verifySignature` to call noble post-quantum
  verification as `verify(signature, message, publicKey)`, matching
  `core/Dilithium.ts` and `core/Sphincs.ts`. The previous browser call used
  `verify(publicKey, message, signature)`, so client-side verification still
  returned `false` even after the base64 decoding fix.
- Verified locally against `ebp-signed-message-756ec50c.json`; the website
  verifier module now returns `true` for that payload.
- Bumped `website/verify.html` script cache buster to `?v=7`.

## [2026-04-28] fix | website verifier signature decoding

- Fixed an encoding bug in `website/crypto.mjs::verifySignature`: the function
  was decoding `signingKey` and `signature` with `hexToBytes`, but per
  `core/Dilithium.ts` and `core/Sphincs.ts` (`bytesToBase64` on the public key,
  `bytesToBase64` on the signed bytes) both fields are **base64-encoded**. Real
  EBP signatures (e.g. `ebp-signed-message-756ec50c.json`) therefore always
  failed client-side verification while the server's `verify-signature` endpoint
  reported them valid — the resulting `serverConsistent: false` was visible in
  the verifier's JSON output.
- Switched `verify.js` to a `is-hidden` class (defined in `styles.css`) and
  moved static inline `style="…"` attributes out of `verify.html` so the page no
  longer trips `style-src 'self'` CSP violations. Also dropped the meta-only
  `frame-ancestors` directive (ignored when delivered via `<meta>`).
- Bumped the `verify.js` cache buster to `?v=6`.
- Updated [[message-payload-formats]] to label `signature` as **base64-encoded**
  (the previous "hex-encoded" wording was the underlying documentation
  contradiction that hid this bug); added a contradiction note to its
  frontmatter.

## [2026-04-28] update | website verifier consistency

- Brought `website/verify.js` and `website/crypto.mjs` in line with the rest of
  the app's verification logic.
- Added browser-side fingerprint computation mirroring `core/Fingerprint.ts`
  (sha256 merkle root + bech32 with `ebpdk`/`ebpsk` HRPs); the verifier now
  re-derives the fingerprint from each identity's signing+encryption keys and
  rejects identities whose keys do not match the claimed fingerprint, mirroring
  the GUI's `verify-file-form` flow.
- Added bech32 format validation on payload and pasted-identity fingerprints
  (matching `server/handlers/verify.ts`) and a payload-vs-embedded-identity
  fingerprint cross-check.
- Added an HTTPS warning prompt when the configured server URL uses `http://`
  (partial mitigation for [[security-audit-2026-04/findings|F-WEB-02]]).
- Removed the now-stale "delegates to the server" description from
  [[component-website]] and documented the actual client-side verification
  pipeline.
- Updated: [[component-website]].

## [2026-04-28] feature | multi-recipient-email

- Added multi-recipient payload documentation:
  `ebp-encrypted-signed-message-multi` and
  `ebp-encrypted-signed-email-attachment-multi` with envelope v3
  recipient-set/attachment-manifest signature binding.
- Updated [[ml-kem]] with the ML-KEM key-wrap pattern used to encapsulate one
  AES content key for many recipients.
- Updated [[overview]] to reflect shared-content-key multi-recipient native
  email support.
- Updated: [[message-payload-formats]], [[ml-kem]], [[overview]].

## [2026-04-28] update | mail message load reliability remediation

- Implemented bounded and instrumented message-read flow:
  `GET /api/v1/mail/messages`, `GET /api/v1/mail/message`, and
  `GET /api/v1/mail/message/attachment` now emit timing metadata/logs and apply
  step timeouts to IMAP connect/lock/fetch/parse stages.
- Implemented frontend cancel + timeout behavior for selected-message fetches,
  including aborting stale requests on new selection/refresh/account-folder
  transitions and surfacing timeout feedback instead of silent hangs.
- Implemented lazy encrypted-attachment payload fetch via
  `GET /api/v1/mail/message/attachment`; body render no longer eagerly parses
  encrypted attachment payloads.
- Updated: [[analysis-mail-message-load-hang]], [[message-payload-formats]],
  [[component-gui]].

## [2026-04-27] query | selected email messages sometimes never load

- Answered: The inbox list is cheap envelope-only IMAP fetch, while selected
  messages fetch and parse full MIME source with no frontend
  timeout/cancellation; stale requests can continue consuming backend IMAP work.
- Filed: [[analysis-mail-message-load-hang]].

## [2026-04-27] ingest | RFC 3986, RFC 5321, RFC 9051, and DID v1.1

- Ingested `Decentralized Identifiers (DIDs) v1.1.pdf` → [[source-did-1-1]].
- Ingested `rfc3986.txt` → [[source-rfc-3986]].
- Ingested `rfc5321.txt` → [[source-rfc-5321]].
- Ingested `rfc9051.txt` → [[source-rfc-9051]].
- Updated: [[decentralized-identifiers]], [[uri-syntax]], [[email-transport]],
  [[overview]], [[identity-model]], [[component-gui]],
  [[component-email-extension]], [[message-payload-formats]],
  [[component-server]], [[component-website]], [[index.md]].
- Contradictions noted: none; the new sources clarify URI, email transport, and
  adjacent decentralized-identity boundaries rather than changing EBP's
  cryptographic identity or payload model.

## [2026-04-25] ingest | Batch raw source ingest

- Ingested `draft-ietf-openpgp-pqc-17.txt` →
  [[source-draft-ietf-openpgp-pqc-17]].
- Ingested `rfc5280.txt` → [[source-rfc-5280]].
- Ingested `NIST.FIPS.140-3.pdf` → [[source-fips-140-3]].
- Ingested `NIST.FIPS.197-upd1.pdf` → [[source-fips-197]].
- Ingested `NIST.SP.800-131Ar2.pdf` → [[source-sp-800-131a-r2]].
- Ingested `NIST.SP.800-57pt1r5.pdf` → [[source-sp-800-57-part-1-r5]].
- Ingested `NIST.SP.800-57pt2r1.pdf` → [[source-sp-800-57-part-2-r1]].
- Ingested `NIST.SP.800-57Pt3r1.pdf` → [[source-sp-800-57-part-3-r1]].
- Ingested `NIST.SP.800-90Ar1.pdf` → [[source-sp-800-90a-r1]].
- Ingested `NIST.SP.800-90B.pdf` → [[source-sp-800-90b]].
- Ingested `NIST.SP.800-90C.pdf` → [[source-sp-800-90c]].
- Ingested `nistspecialpublication800-38c.pdf` → [[source-sp-800-38c]].
- Ingested `nistspecialpublication800-38d.pdf` → [[source-sp-800-38d]].
- Updated: [[overview]], [[index.md]], [[ml-kem]], [[ml-dsa]], [[slh-dsa]],
  [[message-payload-formats]], [[identity-model]], [[revocation-system]],
  [[component-email-extension]], [[aes-gcm]], [[openpgp-pqc]], [[x509-pki]],
  [[random-bit-generation]], [[key-management]],
  [[cryptographic-algorithm-transitions]], [[cryptographic-module-validation]].
- Contradictions noted: OpenPGP PQC is an adjacent packet/certificate standard
  rather than EBP's wire format; RFC 5280 PKIX revocation differs from EBP
  signed revocation certificates; FIPS 140-3 and SP 800-90 sources do not imply
  EBP module/RBG validation; SP 800-57 Part 3's 2015 protocol guidance may be
  stale for modern TLS/S/MIME/SSH allow-lists.

## [2026-04-23] query | top remaining open security issues

- Answered: Ranked the most important unresolved audit findings after the
  2026-04-22 remediation pass — 1 High (`F-TAURI-02`), 1 High-mitigated
  (`F-DEP-02`), 1 conditional High (`F-GUI-05`), plus a prioritised set of
  Mediums.
- Filed: [[analysis-top-open-security-issues]].

## [2026-04-23] ingest | Semantic Versioning 2.0.0

- Ingested `semver.md` → [[source-semver-2-0-0]].
- Updated: [[semantic-versioning]], [[overview]], [[index.md]].

## [2026-04-18] complete | EBP Security Audit — April 2026 (final report)

- Completed all 9 phases of the April 2026 security audit. Final report at
  [[security-audit-2026-04/report]].
- **75 findings** total: 1 Critical, 11 High, 26 Medium, 23 Low, 14
  Informational. Full register: [[security-audit-2026-04/findings]].
- Highest-impact finding: **F-GUI-01** (Critical) — universal cross-origin
  access to the GUI local backend (CORS `*` + no Host validation + no CSRF
  token). Confirmed live with curl PoC reading identities/contexts and writing
  to `~/Downloads/` from `Origin: https://evil.example`.
- Confirmed live: F-CRYPTO-01 (emergency-cert nonce collision), F-CRYPTO-02
  (surreptitious forwarding), F-SERVER-01 (reflected XSS), F-SERVER-04 (CORS
  `*`), F-GUI-01 (4 vectors), F-STORAGE-01/04 (file/dir perms 0664/0775).
- Created phase notes [[security-audit-2026-04/phase-02-crypto-core]] through
  [[security-audit-2026-04/phase-08-dynamic]]; runnable PoCs under
  `wiki/security-audit-2026-04/pocs/`; tooling output (`npm audit`,
  `cargo audit`, deno lint, live curl logs) under
  `wiki/security-audit-2026-04/tooling-output/`.
- Updated [[index.md]] Security Audits entry to reflect completion. README at
  [[security-audit-2026-04/README]] now reflects all phases completed.
- Top-12 prioritised remediation roadmap in
  [[security-audit-2026-04/report#top-12-prioritised-remediation]]; full
  week-1/month-1/quarter-1/backlog roadmap in Appendix A of the report.

## [2026-04-18] create | EBP Security Audit — April 2026 (kickoff)

- Initiated phased security audit covering crypto core, server,
  GUI/local-backend, desktop/Tauri, CLI, website verifier, supply chain, and
  identity storage. Mobile and email Chrome extension are out of scope.
- Created `wiki/security-audit-2026-04/` with [[security-audit-2026-04/README]],
  [[security-audit-2026-04/threat-model]], [[security-audit-2026-04/findings]],
  and [[security-audit-2026-04/phase-01-scaffolding]].
- Linked from [[index.md]] under a new "Security Audits" section.
- Phase 1 complete: scaffolding, threat model, adversary capability matrix,
  trust-boundary diagram, STRIDE per component, and 11 preliminary findings
  raised from cryptographic pre-read.

## [2026-04-10] update | module split documentation

- Updated [[component-gui]] architecture section to reflect the split of
  `gui/app.js` into ES modules under `gui/js/` and `gui/local-backend/main.ts`
  into domain modules (`routes.ts`, `http.ts`, `identity.ts`, `contacts.ts`,
  `mail-account.ts`, `mail-imap.ts`, `mail-oauth.ts`, `hierarchy-local.ts`).
- Updated [[component-server]] to reflect the split of `server/main.ts` into
  handler modules under `server/handlers/` and infrastructure modules
  (`cors.ts`, `rate-limit.ts`, `body.ts`, `response.ts`, `mail-oauth.ts`,
  `verify-email.ts`), plus the split of `server/db.ts` into `server/db/`
  directory.
- Updated [[component-cli]] to reflect the split of `cli/main.ts` into command
  modules under `cli/commands/`.

## [2026-04-12] ingest | RFC 8391 (XMSS) and NIST SP 800-208 (Stateful HBS)

- Ingested two stateful hash-based signature sources from `wiki/raw/`:
  - `rfc8391.txt` → Created [[source-rfc-8391]] (XMSS: WOTS+, single-tree,
    multi-tree parameter sets, security proofs).
  - `NIST.SP.800-208.pdf` → Created [[source-sp-800-208]] (Federal
    recommendation for LMS/XMSS, approved parameter sets, conformance
    requirements, state management).
- Updated [[slh-dsa]] with new "Stateless vs Stateful Hash-Based Signatures"
  section explaining the XMSS/LMS context and why EBP chose the stateless
  SLH-DSA.
- Updated [[overview]] with references to stateful HBS predecessors.
- Updated [[index.md]] source summaries section with two new entries.

## [2026-04-10] update | message-payload-formats receive-side handling

- Updated [[message-payload-formats]] to document receive-side identity
  resolution priority (local contacts → server → embedded keys).
- Documented `serverIdentityMatch` cross-check for embedded identity
  verification.
- Documented sender contact auto-fill behavior.

## [2026-04-10] create | message-payload-formats

## [2026-04-22] update | audit-top12-remediation

- Implemented the April 2026 audit's top-12 remediation set across `core/`,
  `cli/`, `server/`, `gui/`, `website/`, `desktop/`, and `Dockerfile`.
- Closed F-GUI-01 with per-launch CSRF tokening, scoped CORS, and Host
  validation on the GUI local backend.
- Closed F-STORAGE-01 / F-STORAGE-04 / F-STORAGE-02 with `0o600`/`0o700`
  permission hardening, legacy-permission repair, PBKDF2 uplift to 600k, and
  transparent legacy ciphertext upgrade on unlock.
- Closed F-SERVER-01 / F-SERVER-02 / F-SERVER-03 / F-SERVER-05 with verify-email
  HTML escaping + CSP, signed hierarchy rejects, proxy-header trust gating, and
  `USER deno` in the container.
- Closed F-CRYPTO-01 / F-CRYPTO-02 with recipient-bound signed envelopes and a
  separate emergency-revocation nonce space.
- Closed F-CLI-01 with non-echoing terminal password reads.
- Closed F-WEB-01 by moving website verification client-side and adding verifier
  CSP.
- Mitigated F-TAURI-01 and part of F-DEP-02 by scoping `shell.open` and clearing
  `npm audit`; the full Tauri 2.x migration remains a follow-up.

- Created [[message-payload-formats]] page documenting the wire format for all
  EBP message payload types.
- Covers `ebp-encrypted-signed-message`, `ebp-encrypted-message`,
  `ebp-signed-message`, and `ebp-signature` with field-level tables.
- Documents armor wrapping, ciphertext structure (ML-KEM encapsulated key +
  AES-256-GCM), inner payload layout, and the key-material-vs-fingerprint design
  decision.
- Documents the GUI native email compose/decrypt flow end-to-end.
- Added to [[index.md]] under Core Concepts.

## [2026-04-08] lint | wiki-health-check

Lint pass findings and fixes:

- **Missing pages:** Created [[component-mobile]] and [[fn-dsa]] (both listed in
  taxonomy but absent).
- **Orphan risk:** All pages now have inbound links from index.md and at least
  one other page.
- **Stale seeds upgraded:** All seed pages (ml-kem, ml-dsa, slh-dsa,
  identity-model, revocation-system, component-cli, component-gui,
  component-server, component-email-extension) upgraded to `active` with
  codebase-sourced implementation details.
- **Source summaries populated:** Section was empty; now has three FIPS standard
  summaries.
- **Wikilinks verified:** No broken wikilinks found after updates.
- **Rule migration:** Moved `.cursorrules` → `.cursor/rules/wiki-maintainer.mdc`
  with proper Cursor frontmatter. Added workflow trigger phrases to schema.

## [2026-04-08] ingest | NIST FIPS 203, 204, 205

- Ingested three NIST FIPS standards from `wiki/raw/`:
  - `NIST.FIPS.203.pdf` → Created [[source-fips-203]] (ML-KEM standard summary).
  - `nist.fips.204.pdf` → Created [[source-fips-204]] (ML-DSA standard summary).
  - `NIST.FIPS.205.pdf` → Created [[source-fips-205]] (SLH-DSA standard
    summary).
- Updated [[ml-kem]], [[ml-dsa]], [[slh-dsa]] with FIPS parameter tables,
  implementation details from codebase, and source citations.
- Updated [[overview]] with FIPS standard references and scheme summary table.
- Updated [[index.md]] source summaries section.

## [2026-04-06] query | stale-frontend-fix

- Diagnosed stale frontend assets in rebuilt AppImages caused by Cargo caching
  of Tauri `generate_context!()`.
- Implemented sidecar redirect: `distDir` now points to `desktop/dist/`
  containing a lightweight loader that redirects to the sidecar at
  `http://127.0.0.1:8787`.
- Created `desktop/dist/index.html` loader page; updated `tauri.conf.json`
  distDir.
- Reverted earlier workaround attempts (`build.rs` rerun-if-changed,
  `cargo clean -p` in build script).
- Updated [[analysis-linux-build]] with architecture details and fix rationale.

## [2026-04-06] query | linux-build

- Answered how to build EBP on Linux.
- Confirmed the documented local build path uses `build_desktop_linux.sh`.
- Captured required Linux packages, toolchain prerequisites, and output artifact
  in [[analysis-linux-build]].

## [2026-04-06] query | sync-revoked-details-bug

- Investigated why revoked details still appear after Sync From Server.
- Root cause: GUI local backend and mobile app did not strip `revokedDetails`
  from the server response before saving the contact.
- Fixed `gui/local-backend/main.ts` `/api/v1/fetch` handler and
  `mobile/src/services/contacts.ts` `normalizeExternalIdentity`.
- Created [[analysis-sync-revoked-details-bug]] page.

## [2026-04-09] update | detail update workflow docs

- Documented the revoke-before-replace constraint for identity details across
  four wiki pages.
- [[identity-model]]: Added "Updating a Detail" subsection explaining that each
  path allows one active value, the server enforces this with 409 Conflict, and
  the two-step revoke-then-set workflow.
- [[revocation-system]]: Added note to Detail Revocation that revocation is a
  prerequisite for updating a detail.
- [[component-server]]: Added detail uniqueness enforcement note under the
  Details API section.
- [[component-cli]]: Added practical workflow guidance under the Details
  commands section.

## [2026-04-09] create | component-website

- Created [[component-website]] page documenting the static public site
  (`website/`).
- Covers landing page content, browser-based signature verifier (supported
  types, inputs, server integration), privacy page, deployment/assets, and
  design notes.
- Added to [[index.md]] under Components.
- Cross-linked from [[component-server]] (verifier is a consumer of the
  verify-signature endpoint).

## [2026-04-09] update | component-gui toast and file-save docs

- Documented toast notification system (setStatus, auto-dismiss, animation) in
  [[component-gui]].
- Documented backend-routed file save mechanism (`POST /api/v1/save-file`) and
  why blob-URL downloads were replaced.

## [2026-04-05] ingest | initial-wiki-bootstrap

- Initialized wiki framework structure (`wiki/`, `wiki/raw/`).
- Added maintainer schema in `.cursorrules`.
- Created initial `index.md`, `overview.md`, and seed pages.
