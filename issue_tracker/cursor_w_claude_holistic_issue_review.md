# Holistic issue review

Reviewed 2026-11-16 against `HEAD` `f6a89e6`. Covers all 66 issues in
`issue_tracker/issues.json` (8 high, 51 medium, 7 low).

Each issue in the tracker was reviewed in isolation and is careful to say what
it is *not* related to. This review asks the opposite question: which issues
share a cause, which fixes overlap, which earlier decisions produced them, and
what it would cost to change course. Relationships below were checked in the
code, not inferred from issue text. Where a claim rests on inspection rather
than execution, it says so.

## Summary

Most of the 66 issues are symptoms of about ten underlying conditions. Fixing
those conditions would close more issues, and more permanently, than fixing
issues one at a time.

1. **The mobile mail stack is hand-built and decodes bytes to UTF-8 at the
   socket.** 16 issues (#1–#5, #7, #9, #25, #26, #37, #46–#50, #56). The GUI
   has one of the same defects (#37), and mobile has it too in a place the
   tracker does not record.
2. **Local JSON stores have no shared storage layer.** Atomic writes and a
   per-key queue exist but are used only for identity files. 8 issues (#13,
   #16, #17, #18, #19, #52, #55, #62), plus #34 and #35 indirectly.
3. **Contacts are written by six code paths with five different validation
   rules.** A shared validator exists in `core` and most writers skip it. 8
   issues (#12, #13, #17, #30, #34, #35, #43, #44). #12 also exists in the CLI,
   which the tracker does not mention.
4. **Payloads are built and parsed by hand at call sites** instead of through
   the `core` codecs that already exist for some types. 7 issues (#15, #40,
   #41, #42, #44, #45, #53).
5. **"Absent", "failed", and "unknown outcome" are collapsed into one state.**
   11 issues across every component (#2, #4, #11, #13, #18, #21, #24, #29, #40,
   #54, #56).
6. **Several security fixes were applied at an entry point instead of the
   sink.** The validators exist; the GUI and mobile paths do not call them. 6
   issues (#17, #31, #32, #33, #60, #62). #60 + #62 recreate the same
   combination the April audit found as F-CLI-03 + F-STORAGE-10.
7. **Cross-client copies are kept in sync by tests that check agreement, not
   correctness**, and the only CI job builds `c-core`. 7 issues (#9, #29, #38,
   #39, #53, #57, #64). The desktop app has very likely not compiled since the
   Tauri 2 upgrade that closed F-DEP-02.
8. **Payments**: verification semantics differ between chains, and the
   background worker drives an HTTP handler. 7 issues (#10, #11, #21, #22, #23,
   #61, #65). #61 must be fixed before #66 can be fixed cleanly.
9. **Server read paths are composed from connection-level helpers**, and the
   API has no exact verified-email lookup, so clients over-fetch. 5 issues
   (#10, #20, #34, #36, #63).
10. **File bytes travel as Base64 inside JSON.** 4 issues (#14, #15, #51,
    #58). Fixing #51 before #14 would make the GUI worse.

Section 4 lists 17 observations found during this review that are not in the
tracker. Section 3 lists ordering constraints between fixes.

---

## 1. Root-cause clusters

### 1.1 Mobile mail: hand-built protocol stack working on strings

**Issues:** #1, #2, #3, #4, #5, #7, #25, #26, #46, #47, #48, #49, #50, #56;
GUI #37; shared #9.

**What connects them.** The GUI uses `imapflow`, `mailparser`, and
`nodemailer` (`deno.json:19-21`). Mobile implements IMAP, SMTP, MIME, and
RFC 5322 itself on top of `react-native-tcp-socket` (`mobile/src/services/mail/`).
Every mobile issue above is a gap in that implementation. They fall into five
sub-groups:

| Sub-cause | Issues | Evidence |
|---|---|---|
| Bytes become UTF-8 strings at the socket, before MIME sees them | #3 (8bit part), #37 (GUI), new observation N2 | `tcpBuffer.ts:84` and `:98` decode every line and literal with `toString('utf8')`; GUI does the same in `mail-imap.ts` `sourceToString` |
| No MIME entity model: the parser only collects `text/plain` and `text/html` leaves | #3, #25, #26, #50 | `mime.ts:115-149` never reads `Content-Disposition` or `charset`; `mime.ts:183-192` falls back to the whole body |
| Header and address grammar done with regexes, twice | #1, #5, #7, #9, #49, #25 | `imapFetchBody.ts:19-53` and `mime.ts:14-36` are two header parsers; `getBoundary` at `mime.ts:38-41` |
| Server responses checked by substring, no capability negotiation | #2, #4, #46, #47, #48 | `includes(' OK')` at `imapFetchBody.ts:68` **and** `tcpClient.ts:442`; EHLO capabilities discarded |
| Operation lifetime not bound to the caller | #56 | `mailTest.ts:66-86` |

**Does fixing one fix others?**

- One shared header parser (#7) fixes #1 and #5 at the same time, provided it
  extracts the header block once and parses all fields from it.
- #2 is wider than reported. The same `includes(' OK')` test is in
  `readTaggedOk` (`tcpClient.ts:432-453`), which handles about a dozen IMAP
  commands: LOGIN, SELECT, SEARCH, LIST, MOVE, and others. Fix it with one
  `isTaggedOk(line, tag)` helper used in both places.
- #3 cannot be fully fixed in `mime.ts`. For `8bit` parts the original octets
  are already lost in `tcpBuffer.ts` before `mime.ts` runs (N2). Base64 and
  quoted-printable parts can be fixed in `mime.ts` alone. #37 is the same
  defect in the GUI and needs the same fix: keep `Uint8Array` until the
  charset is known.
- A MIME entity tree, with disposition, parameters, and charset per part,
  fixes #26 and #50 and makes #25 a parameter-parser fix rather than a regex
  tweak.
- #47 and #48 are the outbound half of #3 and #37. Mobile assumes UTF-8
  everywhere and never negotiates it. They should be fixed together as one
  charset policy: negotiate `UTF8=ACCEPT`/`SMTPUTF8`/`8BITMIME`, or encode
  (RFC 2047 encoded-words for headers, quoted-printable or Base64 for bodies).
- #9 and #49 are two halves of one missing piece: an RFC 5322 mailbox codec
  that can both parse and format. #9 lives in `common/` plus a GUI JavaScript
  mirror; #49 is mobile-only.
- #46 only affects mobile. `parseImapListLine` is in `common/SentMailbox.ts`,
  but the GUI only calls `pickSentMailbox` because `imapflow` handles LIST.

**Earlier decision behind it.** Building native IMAP/SMTP on mobile was a
Parity v1 must-have (`wiki/analysis-gui-mobile-parity-deltas.md`). The
libraries the GUI uses depend on Node streams and can't run on React Native,
so mobile reimplemented the protocols. The decision was reasonable. What's
missing is an oracle: nothing checks mobile output against the GUI's mature
parsers.

**Approaches and consequences.**

| Approach | Fixes | Consequences |
|---|---|---|
| A. Keep the hand-built stack and fix issues one by one | Each issue | Cheapest per issue. The tracker shows the defect rate: 14 mobile mail issues from two days of review (2026-11-15/16). Expect more. |
| B. Move to bytes at the transport boundary (`readBytes` returns `Uint8Array`, IMAP literals stay binary) | #3 (8bit), and the prerequisite for any charset work; same pattern fixes #37 in the GUI | Touches every `readBytes` caller. `TcpLineClient.readBytes` currently returns `string`. Mostly mechanical. |
| C. One pure-TypeScript `common/mail/` module (header parser, mailbox codec, MIME entity tree over `Uint8Array`) used by mobile. In Deno tests, use `mailparser` as a differential oracle over a fixture corpus. | #1, #3, #5, #7, #9, #25, #26, #49, #50 | Moderate effort. Gives one specified parser, and the GUI's library becomes the test oracle, so mobile and GUI disagreements show up in CI. The GUI keeps `mailparser` for production. |
| D. Adopt a third-party pure-JavaScript MIME parser on mobile (for example `postal-mime`) | Most MIME issues | Less code to own. Charset support on Hermes's `TextDecoder` is **not verified** here and may be UTF-8 only. Adds a dependency to a security-sensitive input path. No RN-compatible IMAP client is known to be maintained, so protocol issues (#2, #4, #46, #47) stay. |
| E. Proxy mail through the key server | All mobile protocol issues | The server would see mail credentials. That contradicts the local-only model and the 2026-11-13 removal of the OAuth mail proxy. Not recommended. |

**Recommendation:** B, then C. B is a prerequisite for correct charset
handling under any approach. C turns the GUI's battle-tested parser into a
free oracle for mobile.

---

### 1.2 Local JSON stores: no shared storage layer

**Issues:** #13, #16, #17, #18, #19, #52, #55, #62; indirectly #34 and #35.

**What connects them.** Commit `4dbb957` ("Fix identity state integrity,
atomic writes") added `writePrivateFileAtomic` (`cli/atomic-file.ts`),
`writeFileAtomic` (`mobile/src/services/atomicFile.ts`), and the shared
`KeyedQueue` (`common/KeyedQueue.ts`). They were applied to identity files
only. Every other local store still does a plain read-modify-write:

| Store | Write | Issue |
|---|---|---|
| Contacts (GUI, CLI, mobile) | `Deno.writeTextFile` / `RNFS.writeFile` in six places | #13 (torn file), #17 (path) |
| GUI hierarchy pending queue | `hierarchy-local.ts:105`, `max(id)+1` | #16 |
| Mobile certificates | `hierarchy.ts:66`, `Date.now()` filename | #52 |
| Mobile mail accounts | `accountStore.ts:258` | #55 |
| GUI mail account and secrets | `mail-account.ts:87-94`, write then `chmod` | #18, #19, N11 |
| Mobile app state | `storage.ts:414` | not filed |
| CLI `state.json` | `cli/utils.ts` `writeState`, even though the file imports the atomic helper | #62, N12 |

Every store also reinvents its read-side error handling, in opposite
directions:

- **Too forgiving.** GUI `readJsonFile` (`mail-account.ts:77-85`) returns
  `null` for every error. `NotFound` and other errors take identical branches,
  so a transient read error becomes "no vault", which then gets overwritten
  (#18).
- **Too strict.** Contact listing in the GUI, mobile, and CLI throws on the
  first bad file (#13, N4).

**Does fixing one fix others?** #18 and #19 are in the same module and both
come from one decision: `mailSecretCache` is both the session store and the
persisted view. `saveMailSecretsStore` caches whatever it persists, so a
session-only secret has nowhere to live (#19). Splitting session secrets from
persisted secrets, and giving reads a result of missing, present, or error,
fixes both.

#16 and #52 are both ID allocation under concurrency. If certificate
filenames were content-addressed (the hash of the certificate), the collision
in #52 couldn't happen, and duplicate saves would deduplicate for free.

**Earlier decision behind it.** Each feature owns its JSON file and its own
I/O. The atomicity fix was scoped to the most valuable file instead of to the
I/O pattern.

**Approaches and consequences.**

| Approach | Consequences |
|---|---|
| A. Patch each store (add a queue here, atomic write there) | Low risk per change. Leaves the pattern in place for the next store, and `4dbb957` (2026-11-15) already shows the result: the stores behind #52 and #55 existed then and were not converted. |
| B. A small `common/` JSON-store module with a filesystem adapter (Deno and RNFS): atomic replace, per-path `KeyedQueue` for read-modify-write, a read result that distinguishes missing, corrupt, and I/O error, per-record isolation for directory stores, and a validated name-to-path mapping | Closes #13, #16, #18, #52, #55 and the write side of #17 in one place. Needs an adapter for each runtime; `KeyedQueue` already shows `common/` can serve both. |
| C. Move local state to SQLite (Deno has it; RN would need a native module) | Transactions solve concurrency and atomicity outright. A much larger migration. It breaks the property that `~/.ebp/` is human-readable JSON shared by the CLI and GUI. |

**Caveat for any approach.** `KeyedQueue` serializes only inside one process.
The CLI and GUI share `~/.ebp/` (`gui/local-backend/contacts.ts:5` imports
`getContext` from `cli/utils.ts`). A CLI command running while the GUI is
open is still unserialized. Atomic replace prevents torn files but not lost
updates between processes. Decide whether that is acceptable or needs a lock
file.

---

### 1.3 Contacts: six writers, no record model

**Issues:** #12, #13, #17, #30, #34, #35, #43; and #44 through the same
validator.

**What connects them.** A contact file is written by six code paths, each
with a different rule set:

| Writer | Fingerprint and keys validated | Alias validated | Keeps server metadata | Stale opaque cache (#12) |
|---|---|---|---|---|
| CLI `contacts import` (`cli/commands/contacts.ts:7-33`) | yes (`validateContact`) | yes | yes (spread) | n/a |
| CLI `server fetch` (`cli/commands/server.ts:200-246`) | yes | yes | **no (#30)** | **yes, not in #12 (N3)** |
| GUI `/contacts/import` (`contacts-routes.ts:37-91`) | bech32 format only | **no (#17)** | yes | n/a |
| GUI `saveExternalContact` (`contacts.ts:136-171`) | presence only | no | yes | yes (#12) |
| Mobile `importContact` (`contacts.ts:184-213`) | presence only (#43) | yes (allowlist regex) | yes | yes (#12) |
| Opaque-resolve and notes updates (GUI, mobile) | n/a | n/a | n/a | rewrites whole file |

`core/EmbeddedIdentity.ts:6-70` (`externalIdentityFromEmbeddedRecord`)
already recomputes the fingerprint from the keys and checks key lengths and
encodings. The CLI uses it through `validateContact`; mobile message
verification uses it (`signVerify.ts:54-61`). Mobile contact import (#43) and
mobile file verification (#44, 50 lines further down the same file) do not.

A contact file also mixes four kinds of data with different trust and
lifetime:

1. Signed claims published by the identity: keys and `details`.
2. Server attestations: `detailsMeta`, `revoked`, `revokedDetails`.
3. Locally derived caches: `resolvedOpaqueDetails`.
4. User notes: `localAlias`, `localDescription`, `localEmail`.

Each writer decides ad hoc which of these to keep on refresh. #12 keeps the
cache by *path* instead of checking it against the new hash. #30 drops the
attestations.

**Cross-client interaction (N4, by inspection).** The CLI validates every
contact *on read* and throws on the first failure (`cli/commands/contacts.ts:48`,
`:117-124`). The GUI's import route writes to the same directory without
checking keys against the fingerprint. One GUI-imported contact with a
mismatched fingerprint would therefore make `ebp contacts list` and
fingerprint-prefix lookups fail in the CLI. That is #13's failure mode,
triggered across clients.

**Does fixing one fix others?** A single `mergeRefresh(existing, fetched)`
fixes #12 in all three clients and #30. A single validated `parseContact`
fixes #43 and supplies the per-record isolation #13 needs. A single
`contactPath(alias)` fixes #17. #34 and #35 are pure I/O amplification. They
become trivial once there is one module to cache in, since the 3N and
N×(K+1) reads come from helpers each calling `listContacts()` again.

**Earlier decisions worth reconsidering.**

- *Contact filename = user alias.* This creates the traversal surface in #17.
  It also forces three different alias rules (CLI blocklist, mobile allowlist,
  GUI none) and allows two files for the same fingerprint. Alternative: name
  files by validated fingerprint and keep the alias inside the record.
  Consequence: a one-time migration, and alias lookups need an index or scan
  (already a scan today). Aliases could then contain any characters.
- *Validation only on import.* Validating on read (CLI style) is safer, but
  without per-record isolation it turns one bad file into a total outage.
  Validate on read **and** isolate per record.

**Recommended shape.** A `common/contacts/` module: `parseContact` (validate,
returning either a contact or a per-file error), `mergeRefresh` (explicit
rules per data class; keep a cached opaque value only if
`sha256(value) === newHash`), `contactPath` (safe name), and a
`VerifiedExternalIdentity` type that only `externalIdentityFromEmbeddedRecord`
can produce. If `Identity.VerifySignature` and the mobile verifiers accepted
only that type, #44 and #43 would become type errors rather than review
findings.

---

### 1.4 Payloads built and parsed outside the core codecs

**Issues:** #15, #40, #41, #42, #44, #45, #53.

**What connects them.** `core/` has typed builders for file payloads
(`FilePayload.ts`) and a version-checking parser
(`core/PayloadInput.ts:5-30`). The parity wiki records the earlier fix for
this exact class of bug: "File payload `version` → `buildEncryptedFilePayload`
… in `core/FilePayload.ts`". Other payload types never got the same
treatment:

- The emergency-certificate wrapper is hand-built in six places:
  `cli/commands/details.ts:193`, `cli/commands/hd.ts:177`,
  `cli/commands/identity.ts:105`, `gui/local-backend/revocation-routes.ts:174`,
  `mobile/src/services/revocation.ts:92` (missing `version`, #42), and
  `gui/local-backend/tests/test_handler.ts:1768`.
- The CLI parses with bare `JSON.parse` (`cli/commands/crypto.ts:100`, `:111`,
  `:227`; `files.ts:81`) instead of `parseEbpPayloadInput` (#41), so it also
  skips strict duplicate-key checks.
- Mobile's `sendEbpMail` stopped honoring `includePublicKeys` (#53) in commit
  `1157500` (2026-10-18, "before I do anything crazy"). That commit replaced a
  higher-level helper with direct calls to payload builders. The GUI still
  honors the flag (`mail-routes.ts:875`).
- #15 is a writer/reader asymmetry inside `core` itself. The C core has the
  same reader rule (`c-core/src/file_payload.c:176` requires nonblank
  `fileDataBase64`), so a fix must change TypeScript, C, and the Python
  binding together or interop breaks (N14).

**#45 has a cheap fix with no format change.** Every producer generates the
salt as hex or empty: `cli/commands/crypto.ts:32`, `gui/app.js:989`,
`mobile/src/services/signVerifyLogic.ts:28`. The file hash is fixed-length
hex and hex cannot contain `:`. If every verifier (core, mobile, GUI
JavaScript, `website/verify.js:80`) rejects salts that aren't
`/^[0-9a-f]*$/`, the string `ebp::filehash::<hash>::<salt>::<context>` parses
only one way. All honestly produced signatures stay valid. The longer-term
fix is a length-prefixed or canonical-JSON signed form in the next format
version, the approach already taken for hierarchy certificates (F-CRYPTO-07).

**#40 and #41** are both in `cmdDecrypt` and `cmdVerify`. Fix them together
when the CLI moves to `parseEbpPayloadInput`.

**Recommendation.** Every payload type gets a `build*` and `parse*` pair in
`core`, plus a round-trip property test (build → stringify → parse equals the
input, including edge values such as empty files). That test would have
caught #15 and #42. Then delete the hand-built sites.

---

### 1.5 "Absent", "failed", and "unknown" collapsed into one state

**Issues:** #2, #4, #11, #13, #18, #21, #24, #29, #40, #54, #56.

These span mobile, GUI, CLI, server, website, and the database adapter, so
they are not one bug. They are one habit: a binary success/failure (or
found/absent) where the domain has at least three states.

| Collapse | Instances |
|---|---|
| Error → "absent" | #18 (read error → empty vault); #29 (HTTP 503 → unused slot) in CLI, GUI, and mobile (N7) |
| Failure → success | #2 (`NO … OK` → OK); #40 (verify failed → exit 0) |
| Completed → still waiting | #4 (251/252 not recognized) |
| Unknown outcome → retry as if nothing happened | #21 (`eth_sendTransaction` resent); #54 (INSERT or COMMIT replayed), and N8: the whole `writeTransaction` replays |
| Decision made → in-flight work continues | #24 (lock vs pending unlock); #56 (timeout vs running test) |
| Failure → no context | #11 (HTTP status only, no order ID) |

**An upstream cause for #29.** The server answers an unknown identity with
`400 {error:"unknown subject"}` (`server/handlers/identity.ts:264`). All
three clients' discovery loops (`cli/commands/hd.ts:237-241`,
`gui/local-backend/identity-routes.ts:255-263`,
`mobile/src/services/hd.ts:114-121`) can only test `res.ok`. A 404 would let
them treat 404 as absent and anything else as an error. Clients today only
check `res.ok`, so they wouldn't break, but other API consumers should be
checked first. The GUI and mobile loops also swallow network exceptions, so
an offline recovery returns an empty, successful result.

**Approaches.**

- Explicit result types at the boundaries where the collapse happens:
  `{kind:'missing'|'ok'|'error'}` for reads, and
  `{kind:'done'|'failed'|'unknown'}` for non-idempotent writes.
- For non-idempotent operations, never retry blindly after an unknown
  outcome:
  - #54: retry only on errors raised before the statement was sent, or make
    writes idempotent (`ON CONFLICT DO NOTHING RETURNING`, then re-read).
  - #21: fall back only on an explicit invalid-params error (`-32602`).
- Cancellation for mobile async work (see 1.11).

---

### 1.6 Payments

**Issues:** #10, #11, #21, #22, #23, #61, #65; and #66 through the
authorization mechanism.

**Sub-causes.**

1. **The background worker calls an HTTP handler** (#10, #11).
   `reconcilePendingPayments` builds a fake `Request` for each order
   (`mail-payment.ts:465-473`). That is why expiry reruns per order (#10) and
   why errors arrive as bare status codes with no order ID (#11). Extract
   `refreshPaymentOrder(db, order, now)` as a domain function; the handler and
   the worker both call it, and the worker expires once per batch. One
   refactor closes both issues. It is a concrete case of the "DB layer
   abstracts the connection, not EBP actions" debt in
   `wiki/analysis-application-complexity-debt.md`.
2. **The two chains use different transaction models.** The Cardano
   transaction is built by the server (`handleCardanoUnsigned`), which checks
   expiry and payability first. The Ethereum transaction is built in the
   browser, with no server pre-flight (#22) and a blind fallback retry (#21).
   The Cardano path forwards every UTxO into a 40-UTxO limit (#23).
   - Cheap fix: before sending on Ethereum, re-fetch status, check `expiresAt`
     with a margin, and narrow the fallback (fixes #21 and #22 in one edit to
     `payEthereum`).
   - Policy option: accept a transaction hash after quote expiry, up to
     `graceUntil`, when the block time precedes `expiresAt`. Consequence:
     buyers who paid on time are never stranded, but the server must fetch
     block timestamps, and names stay held longer.
   - For #23: request `getUtxos(amount)` (CIP-30 supports an amount
     argument) or select the largest 40 UTxOs on the client.
3. **What counts as a payment differs by chain** (#65). The Ethereum checker
   requires `receipt.status == 1` (`verification.ts:92`). The Cardano checker
   reads neither `valid_contract` nor each output's `collateral` flag
   (`verification.ts:180-189`). Write down one definition ("outputs that
   exist after the transaction succeeded") and implement it for both. This is
   the one high-severity issue where the fix is small and the exposure is
   financial.
4. **Payment authorizations reuse the detail-proof nonce, but the nonce
   ledger only reads the `details` table** (#61). `ensureNewNonce`
   (`server/db/index.ts:426-448`) computes `MAX(proof_nonce)` over `details`
   only. Payment-create proofs are recorded on orders, and payment-recover
   proofs are recorded nowhere (N10), so a captured recover proof can be
   replayed within its 10-minute window. The impact is low: it returns only an
   order ID.

**The #61 → #66 dependency.** The natural fix for #66 (unauthenticated
resend of verification email) is to require a signed request from the
identity owner, which means another detail-proof-style authorization. Adding
it before #61 is fixed adds a third consumer to a nonce space that already
leaks. Fix the ledger first.

| Nonce-ledger approach | Consequences |
|---|---|
| A `used_nonces(identity, nonce, purpose)` table that every consumer writes | Exact replay protection and auditable. One more write per authorization; a migration is needed. |
| A per-identity high-water-mark column on `identities`, updated by every consumer | Cheap check. Loses per-purpose history. Concurrent consumers need an atomic `UPDATE … WHERE hwm < ?`. |
| Separate nonce spaces per purpose (domain-separated proof paths already exist) | Least migration. Clients must keep several counters, and the existing single counter in identity files would need versioning. |

A per-detail cooldown using `verification_sent_at`, which is written but
never read, can fix the mail-volume half of #66 independently and
immediately.

---

### 1.7 Security fixes applied at the entry point instead of the sink

**Issues:** #17, #31, #32, #33, #60, #62.

The pattern: a validator exists, but it is called by one front end rather
than by the function that actually opens the file, prints the text, or
fetches the URL.

- **#60 + #62 recreate F-CLI-03 + F-STORAGE-10.** The audit text for F-CLI-03
  (`wiki/security-audit-2026-04/phase-05-cli-website-tauri.md:50-60`) located
  the problem at the *read* (`ctx.server` from `state.json`). The CLI applies
  `normalizeServerUrl` both on write (`cmdServer`) and on read (`ensureServer`,
  `cli/utils.ts:356-371`). The GUI's read point, `resolveServer`
  (`gui/local-backend/identity.ts:118-122`), only strips trailing slashes. So
  does the forked copy in `tests/test_handler.ts:204-208`. Adding the
  normalizer to `resolveServer` fixes #60 for the GUI and also removes the
  downgrade-to-HTTP impact of #62. What remains of #62 (swapping to an
  attacker's HTTPS server) needs the unversioned-state fallback in `readState`
  (`cli/utils.ts:95-110`) removed or limited. Option: accept an unversioned
  file only for `currentIdentity` and ignore its `server`. That keeps old
  installs working while removing the substitution.
- **#17**: `validateContactName` exists in `cli/commands/contacts.ts:73-81`
  and the GUI imports from the CLI elsewhere, but `contacts-routes.ts`
  doesn't call it. A `contactPath()` sink function (1.3) fixes it
  structurally.
- **#31**: terminal output of server-controlled strings. There is no
  `sanitizeForTerminal` helper; add one in `cli/utils.ts` and route all
  remote strings through it.
- **#32 and #33** are the same script and the same root: `deploy_ftp.py`
  validates the configured path syntactically, and `connect()` performs
  mutating `CWD`/`MKD` before checking `dry_run`. Normalize the path with
  `posixpath.normpath`, reject results containing `..` or with fewer than N
  components, and make dry-run use a non-mutating `cwd`.

---

### 1.8 Cross-client copies, and tests that check agreement

**Issues:** #9, #29, #38, #39, #53, #57, #64; contributes to #12 and #42.

**Copies found.**

| Logic | Copies | Issue |
|---|---|---|
| Address-list parsing | `common/ComposeRecipients.ts` and `gui/js/compose-recipients-logic.js` | #9 |
| Hierarchy layout | `gui/js/hierarchy.js` and `mobile/src/services/hierarchyLayout.ts` | #38, #39 |
| HD discovery loop | CLI, GUI, mobile | #29, N7 |
| Contact refresh merge | CLI, GUI, mobile | #12, N3 |
| Emergency wrapper | 6 sites | #42 |
| File-sign message builder | `core`, `gui/js/crypto-utils.js`, `website/verify.js` | #45 |
| `bytesToBase64` | `core/Base64.ts`, `gui/local-backend/http.ts:235` | #14, N6 |
| GUI request handler | `gui/local-backend/*-routes.ts` and `tests/test_handler.ts` | #64 |

**Why the tests didn't catch them.**

- The address parser has a shared-fixture test that runs both copies
  (`gui/js/compose-recipients-logic.js:1-3`). None of the fixtures contains a
  quoted display name, so both copies are wrong in the same way and the test
  passes. Parity tests guarantee agreement, not correctness. They need
  adversarial fixtures, or an oracle such as `mailparser`'s `addressparser`.
- Hierarchy layout has no cross-implementation test. `test/mobile-parity_test.ts`
  only exercises the mobile version.
- `test_handler.ts` is a 1,900-line fork whose header says it re-exports
  `main.ts`. It has been edited alongside production since March 2026 (last
  2026-11-09), so each feature has been written twice.
  `route_dispatch_test.ts` already calls the real `handleRequest`, so the fork
  can be deleted and `main_test.ts` pointed at the real handler.
- `.github/workflows/` contains only `c-core.yml`. None of `test:core`,
  `test:cli-utils`, `test:gui-backend`, `test:server`, or `test:mobile` runs
  automatically, and nothing builds the desktop app.

**#57 in context.** The newest desktop artifacts in `final_builds/` are dated
2026-04-24/25. Tauri went from 1.6 to 2 in commit `a19c50a` on 2026-04-28,
the fix for F-DEP-02. `path_resolver()` calls date from February. So the
desktop app has very likely not compiled since F-DEP-02 was marked fixed
(N13). The audit item was closed on the dependency change, without a build.

**Earlier decisions worth reconsidering.**

- *"Browser GUI cannot import Deno core/"* (`gui/js/fingerprint.js:2`). The
  GUI is served by the Deno backend, which could serve transpiled `common/`
  and `core/` modules (for example a `deno bundle` or esbuild step at
  startup). Consequence: the GUI gains a build step, and all `gui/js/*`
  mirrors can be deleted. The static `website/` still needs its own copy,
  which the complexity-debt page correctly calls necessary.
- *Parity meant feature parity, with only wire formats shared.* The parity
  record lists shared modules for formats only. Policies such as discovery,
  contact merge, and server-URL rules were rebuilt per client, and each
  rebuild is a chance to diverge. Moving these policies into `common/` with
  injected I/O (as `VerifiedEmailMatch.ts` already does with `fetchPage`) is
  the cheapest structural fix.
- *CI only for `c-core`.* Running the existing Deno test tasks plus
  `cargo check` for `desktop/src-tauri` would have caught #57 and #64, and
  would keep any fix in this review from silently regressing.

---

### 1.9 Server read paths and the missing exact lookup

**Issues:** #10, #20, #34, #36, #63.

- #20 (full certificate rows loaded only to use edge columns) and #36 (three
  queries for one identity view) are the "DB layer abstracts the connection,
  not EBP actions" debt in `wiki/analysis-application-complexity-debt.md`
  §3. Handlers compose general helpers instead of asking for the projection
  they need.
- #63 has a second, API-level cause. There is no endpoint for "the unrevoked
  identity whose *verified* email equals X". Clients emulate one with a
  substring search, walking up to 10 pages of 100 full identities, proofs
  included, and filtering locally (`common/VerifiedEmailMatch.ts:82-97`).
  The GUI then fetches the chosen identity again. Mobile's #34 pays for the
  same design from the other side.

| Approach | Fixes | Consequences |
|---|---|---|
| `GET /api/v1/identities/by-verified-email?email=` doing an exact, indexed match returning at most a few rows | Worst case of #63; simplifies #34; makes "ambiguous" exact instead of "stopped after 1,000 rows" | Looks like a new enumeration oracle, but the existing substring search already reveals strictly more. Clients keep a fallback until all servers deploy it. |
| Omit `proof` from list and search responses (`fields=` parameter, or a summary shape) | Rest of #63 | Clients that verify proofs from directory results must fetch the identity. Today none do (`render.js` uses only the strings). |
| Repository-style read models (`getIdentityView(fp)` in one query) | #20, #36 | The refactor the complexity-debt page already recommends. |

---

### 1.10 File bytes as Base64 inside JSON

**Issues:** #14, #15, #51, #58.

The file envelope stores the file as `fileDataBase64` inside JSON, which is
encrypted and then Base64-encoded again into the outer payload. Every layer
pays for that representation:

- #14: per-byte string concatenation in `core/Base64.ts:2-8`. The GUI has a
  second copy in `http.ts:235-239` used on the decrypt path (N6).
- #58: the C core serializes and reparses the Base64 string to change a
  `type` field.
- #51: the GUI transport is JSON with a 512 KiB cap (`http.ts:29`). The same
  reader is used by `/api/v1/mail/send` and `/send-ebp` (`mail-routes.ts:742`,
  `:803`), so outgoing GUI mail attachments are limited to roughly 380 KiB of
  raw data too (N5).
- #15: the empty-string edge case of the same field.

**Ordering constraint.** The tracker measured about 133 MiB of transient heap
to encode 4 MiB with the current `bytesToBase64`. If #51 is fixed by raising
the cap to allow 25 MiB, the GUI will run that encoder on inputs about six
times larger. Assuming linear growth (an assumption, not measured), that is
on the order of 800 MiB transient. **Fix #14 (chunked encoding, in both
copies) before #51.**

| Approach for #51 | Consequences |
|---|---|
| Per-route body limit (file and mail routes allow about 34 MiB; control routes keep 512 KiB) | Smallest change. Keeps the F-GUI-08 protection for everything else. |
| Send file bytes to the local backend as a binary body (`application/octet-stream` or multipart) | Removes one Base64 layer in transit and the JSON parse of large strings. More frontend change. |
| Binary inner envelope in the next file-format version | Removes the double expansion everywhere (CLI, mobile, C). Needs a format-version bump and dual-read support. Worth bundling with the #45 long-term fix. |

---

### 1.11 Mobile async work outlives the decision that should cancel it

**Issues:** #24, #56; related #55.

`cacheUnlockedIdentity` awaits a settings read and then unconditionally
stores the key (`unlockSession.ts:138-152`), so a `lockAll()` during that
await is undone (#24). `withTimeout` rejects the caller but lets `run()`
continue into SMTP (#56). Neither has a cancellation token or epoch. The
`timeoutGeneration` counter is the beginning of one, but it only guards the
timeout setting.

Fix: a lock epoch. `lockAll()` increments it; `cacheUnlockedIdentity`
captures it before awaiting and refuses to store if it changed. Pass an
`AbortSignal` (or a closed flag) through mail operations so a timeout closes
the client. The GUI's `unlock-session.ts` routes mutations through
`KeyedQueue`; check whether it has the same in-flight-versus-lock window.
This review did not check.

---

### 1.12 HD recovery: silent success with the wrong result

**Issues:** #27, #28, #29.

These are three different bugs, but they combine badly because they share one
user flow. During recovery, a user can derive different key material than the
path they typed (#27), from a different index than they typed (#28), and miss
published identities when the server is busy (#29). In every case the
command reports success. Recovery is the flow where silent success is most
dangerous.

#27 and #28 share a pattern with #30 and #42: the code parses or receives a
complete value, then rebuilds a new object from a subset of its fields. The
fix for #27 is to pass the parsed path through rather than reconstruct it
from `profile/account/change/index`. Alternatively, reject any hardening the
reconstruction can't represent. #29 is covered in 1.5, and its copies are in
1.8.

---

### Standalone issues

These were investigated and have no meaningful relationship beyond the
pattern notes above:

- **#6 and #8**: both in `core/StrictJson.ts`; fix them together. #6 is
  efficiency and #8 is auditability of the same scanner.
- **#39 and #59**: the same idiom (array `includes` for deduplication) in
  unrelated code. Each is trivial to fix with a `Set`. #39 disappears if #38
  is fixed by sharing the mobile layout with the GUI and the shared version
  uses a `Set`.
- **#31**: covered in 1.7, otherwise isolated.
- **#66**: covered in 1.6. The per-detail cooldown half is independent.

---

## 2. Patterns across clusters

**Lossy re-projection.** Code receives a complete, validated object and
builds a new one from a hand-picked subset of fields, losing the rest:

- #27: HD path → `profile/account/change/index` → reconstructed path.
- #30: server identity → CLI `ExternalIdentity` without metadata.
- #42: emergency wrapper without `version`.
- #19: secrets → filtered store → cache.
- #37 and N2: bytes → UTF-8 string.
- #53: a refactor dropped a flag.

Where possible, pass the validated value through, or spread it and override
fields, as `validateContact` does at `cli/commands/contacts.ts:99`.

**Validators exist but aren't on the path.** `externalIdentityFromEmbeddedRecord`
(#43, #44), `validateContactName` (#17), `normalizeServerUrl` (#60),
`parseEbpPayloadInput` (#41), `writePrivateFileAtomic` and `KeyedQueue`
(1.2). The fix is mostly wiring, plus types that make the unvalidated path
hard to reach.

**Earlier fixes scoped narrower than their findings.**

| Earlier fix | Scope applied | Residual issue(s) |
|---|---|---|
| F-CLI-03 (2026-04-28) | CLI write and read | #60 (GUI and mobile) |
| F-STORAGE-10 (2026-04-30) | Version-2 envelope only | #62 (unversioned fallback) |
| F-DEP-02 (Tauri 2 bump, 2026-04-28) | Dependency manifest | #57 (application code; no build since) |
| `4dbb957` atomic writes | Identity files | #13, #16, #18, #52, #55 |
| June 2026 file-payload `version` builders | File payloads | #42 (emergency wrapper) |
| F-CRYPTO-07 (delimiter ambiguity) | Hierarchy certificates | #45 (file signatures) |

When closing future findings, it would help to ask "where else does this
pattern occur?" and to record the answer in the finding.

---

## 3. Ordering constraints between fixes

| Do first | Then | Why |
|---|---|---|
| #14 (chunked Base64, both copies) | #51 (raise GUI body cap) | Otherwise the cap increase multiplies the transient heap (1.10) |
| #61 (nonce ledger) | #66 (signed resend) | A signed-resend fix adds another consumer of the leaky nonce space |
| Bytes at the transport boundary (1.1 B) | #3 (8bit charset), #37 | 8bit octets are lost before the MIME layer |
| Contact module (1.3) | #12, #17, #30, #43 | One fix instead of three or four per issue |
| CI for Deno tests and `cargo check` | Everything else | Fixes in this tracker should not regress silently (#57, #64) |
| Delete `test_handler.ts` fork (#64) | GUI backend changes | Otherwise GUI fixes are tested against a stale copy |
| TypeScript, C, and Python change together | #15 | The C reader has the same rule (N14) |

---

## 4. Observations not in the tracker

These came up while checking relationships. All are from code inspection
unless stated; none was reproduced with a harness the way the tracker's
issues were. Each may deserve its own tracker entry after confirmation.

| # | Observation | Location | Related |
|---|---|---|---|
| N1 | `readTaggedOk` uses the same `includes(' OK')` check as #2, for about a dozen IMAP commands | `mobile/src/services/mail/tcpClient.ts:442` | #2 |
| N2 | Mobile decodes every IMAP line and literal as UTF-8 before MIME parsing, the same irreversible step as GUI #37 | `mobile/src/services/mail/tcpBuffer.ts:84`, `:98` | #3, #37 |
| N3 | CLI `server fetch` keeps stale `resolvedOpaqueDetails` by path, a third copy of #12 | `cli/commands/server.ts:224-235` | #12 |
| N4 | CLI validates contacts on read and throws on the first invalid one; a GUI-imported contact with a mismatched fingerprint would break CLI listing and prefix lookup | `cli/commands/contacts.ts:48`, `:117-124`; `gui/local-backend/contacts-routes.ts:47-60` | #13, #43 |
| N5 | GUI mail send routes share the 512 KiB JSON cap; attachments are limited to about 380 KiB | `gui/local-backend/mail-routes.ts:742`, `:803`; `http.ts:29` | #51 |
| N6 | A second per-byte `bytesToBase64` in the GUI backend, used for decrypted file output | `gui/local-backend/http.ts:235-239`; `file-routes.ts:201`, `:351` | #14 |
| N7 | GUI and mobile HD discovery have #29's `res.ok` logic and also swallow network errors, so offline recovery reports nothing found | `gui/local-backend/identity-routes.ts:255-263`; `mobile/src/services/hd.ts:114-121` | #29 |
| N8 | `writeTransaction` also runs inside `withClient`, so a transient error at `COMMIT` replays the whole transaction, not just single statements | `server/db/postgres.ts:140-177` | #54 |
| N9 | The Cardano verifier never checks `valid_contract`; the Ethereum verifier checks `receipt.status` | `server/payments/verification.ts:147-194` vs `:92` | #65 |
| N10 | Payment-recover proofs pass `ensureNewNonce` but are never recorded, so they can be replayed within 10 minutes (returns an order ID only) | `server/handlers/mail-payment.ts:214-227` | #61 |
| N11 | `writePrivateJson` writes with default permissions and then `chmod`s; not atomic | `gui/local-backend/mail-account.ts:87-94` | #18 |
| N12 | `writeState` is a plain write although the same file imports the atomic helper; a torn `state.json` makes every `getContext` throw | `cli/utils.ts` (`writeState`) | #62, 1.2 |
| N13 | No desktop build since the Tauri 2 bump: artifacts 2026-04-24/25, bump `a19c50a` 2026-04-28, no CI | `final_builds/`, `.github/workflows/` | #57 |
| N14 | The C core also rejects empty `fileDataBase64`; #15 needs a coordinated fix | `c-core/src/file_payload.c:176` | #15, #58 |
| N15 | `wiki/analysis-checkout-wallet-submission.md` (updated 2026-11-14) says checkout "does not connect to a wallet"; it now does | `website/checkout.js:123-164` | #21–#23 |
| N16 | The server answers an unknown identity with HTTP 400, which prevents clients from separating absent from error | `server/handlers/identity.ts:264` | #29 |
| N17 | The #53 regression entered with commit `1157500` (2026-10-18) | `mobile/src/services/mail/ebpMail.ts` | #53 |

---

## 5. Earlier decisions worth reconsidering

| Decision | Issues it contributes to | Alternative | Main cost of changing |
|---|---|---|---|
| Mobile mail built on strings | #3, #37 (pattern), N2 | Bytes until charset is known | Change the `readBytes` return type |
| No oracle for the hand-built mobile mail stack | 14 mobile mail issues | `mailparser` as a differential oracle in Deno tests | Fixture corpus |
| Each store owns its JSON I/O | 1.2 (8 issues) | Shared JSON-store module | Runtime adapters |
| Contact filename = alias | #17, three alias rules | Filename = fingerprint | One-time migration |
| Contact file mixes claims, attestations, caches, notes with ad hoc merge rules | #12, #30 | One `mergeRefresh` with rules per data class | Little |
| Hand-built payloads at call sites | 1.4 (7 issues) | `build*`/`parse*` pairs plus round-trip tests in `core` | Migrating six-plus sites |
| One nonce space across uses, stored only in `details` | #61, N10, blocks #66 | `used_nonces` table | Migration |
| Background worker drives the HTTP handler | #10, #11 | Domain function shared by both | Small refactor |
| Client-side exact verified-email match over substring search | #63, #34 | Exact-lookup endpoint | New endpoint; clients keep a fallback |
| Browser GUI can't import `core`/`common` | #9, #38, #39, #45 copies | Backend serves transpiled modules | GUI build step |
| Parity = features, only formats shared | #12, #29, #42, #60 copies | Policies in `common/` with injected I/O | Per-policy extraction |
| CI only for `c-core` | #57, #64, regressions generally | Run existing Deno tasks plus `cargo check` | CI minutes |
| File bytes as Base64 in JSON | #14, #15, #51, #58 | Binary transport; binary inner envelope in the next format | Format version bump |

---

## 6. Suggested sequence

Grouped so each step closes several issues and unblocks the next.

1. **Safety net.** Add CI for `test:core`, `test:cli-utils`,
   `test:gui-backend`, `test:server`, and `test:mobile`, plus `cargo check`
   for the desktop app. Delete the `test_handler.ts` fork (#64). Fix #57.
2. **Small, high-severity fixes.**
   - #65 (Cardano collateral and `valid_contract`).
   - #44 (bind the fingerprint with the existing validator).
   - #32 and #33 (FTP path normalization and a non-mutating dry run).
   - #4 and #2 together with N1 (one tagged-status helper).
   - #24 (lock epoch).
   - #18 and #19 together (split session and persisted secrets; three-state
     read result).
3. **Contacts module** (1.3): closes #12 (×3 with N3), #13, #17, #30, #34,
   #35, #43.
4. **Storage module** (1.2): closes #16, #52, #55, N11, N12; finishes #13.
5. **Payload codecs** (1.4): #15 (with C and Python), #40, #41, #42, #53, and
   the hex-only salt check for #45.
6. **Sink validation** (1.7): #60 and #62 together, #31.
7. **Payments** (1.6): the worker refactor (#10, #11); `payEthereum` (#21,
   #22); #23; the nonce ledger (#61, N10); then #66.
8. **Mobile mail** (1.1): bytes at the boundary, then the `common/mail/`
   module with a `mailparser` oracle.
9. **Efficiency** (1.9, 1.10): #14 before #51; the exact-lookup endpoint; #20,
   #36, #63; #6, #8, #39, #58, #59.
10. **HD recovery** (1.12): #27, #28, and #29 with N7 and N16.

---

## Appendix: issue-to-cluster index

Cluster numbers refer to section 1. "Also" lists issues that share a cause
or a fix.

| Issue | Severity | Cluster | Also |
|---|---|---|---|
| #1 | M | 1.1 | #5, #7 |
| #2 | M | 1.1, 1.5 | N1, #4 |
| #3 | M | 1.1 | #37, #47, #48, N2 |
| #4 | H | 1.1, 1.5 | #2 |
| #5 | M | 1.1 | #1, #7 |
| #6 | M | standalone | #8 |
| #7 | L | 1.1 | #1, #5 |
| #8 | L | standalone | #6 |
| #9 | M | 1.1, 1.8 | #49 |
| #10 | M | 1.6, 1.9 | #11 |
| #11 | L | 1.6, 1.5 | #10 |
| #12 | H | 1.3 | #30, N3 |
| #13 | M | 1.2, 1.3 | N4, #18 |
| #14 | M | 1.10 | #51, N6, #58 |
| #15 | L | 1.4, 1.10 | N14, #58 |
| #16 | M | 1.2 | #52, #55 |
| #17 | M | 1.3, 1.7 | #60 |
| #18 | H | 1.2, 1.5 | #19, N11 |
| #19 | M | 1.2 | #18 |
| #20 | M | 1.9 | #36 |
| #21 | M | 1.6, 1.5 | #22, #54 |
| #22 | M | 1.6 | #21 |
| #23 | M | 1.6 | #22 |
| #24 | H | 1.11, 1.5 | #56 |
| #25 | M | 1.1 | #26, #50 |
| #26 | M | 1.1 | #50 |
| #27 | M | 1.12 | #28, #30 (pattern) |
| #28 | L | 1.12 | #27 |
| #29 | M | 1.12, 1.5, 1.8 | N7, N16 |
| #30 | M | 1.3 | #12 |
| #31 | M | 1.7 | — |
| #32 | H | 1.7 | #33 |
| #33 | M | 1.7 | #32 |
| #34 | M | 1.3, 1.9 | #35, #63 |
| #35 | M | 1.3 | #34 |
| #36 | M | 1.9 | #20 |
| #37 | M | 1.1 | #3, N2 |
| #38 | M | 1.8 | #39 |
| #39 | M | 1.8 | #38, #59 |
| #40 | M | 1.4, 1.5 | #41 |
| #41 | M | 1.4 | #40 |
| #42 | M | 1.4, 1.8 | — |
| #43 | M | 1.3 | #44 |
| #44 | H | 1.3, 1.4 | #43 |
| #45 | M | 1.4 | — |
| #46 | M | 1.1 | — |
| #47 | M | 1.1 | #48, #3 |
| #48 | M | 1.1 | #47, #49 |
| #49 | M | 1.1 | #9 |
| #50 | L | 1.1 | #26 |
| #51 | M | 1.10 | #14, N5 |
| #52 | M | 1.2 | #16 |
| #53 | M | 1.4, 1.8 | N17 |
| #54 | M | 1.5 | N8, #21 |
| #55 | M | 1.2, 1.11 | #16 |
| #56 | M | 1.11, 1.5 | #24 |
| #57 | H | 1.8 | N13 |
| #58 | M | 1.10 | #14, #15 |
| #59 | M | standalone | #39 |
| #60 | M | 1.7 | #62 |
| #61 | M | 1.6 | #66, N10 |
| #62 | L | 1.7, 1.2 | #60, N12 |
| #63 | M | 1.9 | #34 |
| #64 | M | 1.8 | #60 (copy) |
| #65 | H | 1.6 | N9 |
| #66 | M | 1.6 | #61 |
