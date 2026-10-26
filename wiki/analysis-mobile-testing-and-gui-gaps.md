---
title: "Mobile Testing Status and GUI Feature Gaps"
type: analysis
status: active
last_updated: 2026-10-20
source_count: 6
tags:
  - analysis
  - mobile
  - gui
  - testing
  - e2e
  - maestro
  - parity
---

# Mobile Testing Status and GUI Feature Gaps

Snapshot of [[component-mobile]] Maestro E2E vs [[component-gui]] Playwright,
plus GUI capabilities that still have no mobile UI. Complements
[[analysis-mobile-e2e-framework]] (harness) and
[[analysis-gui-mobile-parity-deltas]] (finish-line Android parity closed
2026-09-09; OAuth and Downloads remain out of scope / desktop-only).

## Mobile E2E: how many pass

Default suite is **11 Maestro flows** (`deno task test:e2e:mobile`):

| Flow | Coverage | Last known result |
|------|----------|-------------------|
| `smoke.yaml` | Launch, More (About, Mail trace, Diagnostics, self-test, Activity log, Settings) | **Passed** (2026-08-24) |
| `mail-help.yaml` | Mail tab → accounts → Help (`mail-help-body`); no live mailbox | Added 2026-09-09 (Wave 4) |
| `identity.yaml` | HD create, set server, wrong-password publish, successful publish | **Passed** (2026-08-17) |
| `create-random.yaml` | Random-key create → fingerprint on detail | Not yet re-run on device |
| `onboarding.yaml` | Get started: address, password, 24-word quiz, create through mailbox error when Stalwart is unreachable | **Passed** (2026-10-20, moto g 5G, ~3m 40s) |
| `details.yaml` | HD create + publish, push email detail, Contacts browse/search | **Passed** (2026-08-17) |
| `contacts-lifecycle.yaml` | Export public JSON, emergency cert, fetch, notes, delete contact + identity | **Passed** (2026-08-24, ~3m 30s) |
| `sign-verify.yaml` | Sign attached message, paste payload, verify | **Passed** (2026-08-24) |
| `verify-public-keys.yaml` | HD create, export public JSON, detached + include-identity OFF, verify with pasted public keys | Added 2026-09-09 (Wave 4; large-JSON paste best-effort) |
| `hierarchy.yaml` | Two HD identities, propose/accept, Load Tree | **Passed** (2026-08-17) |

Smoke and contacts-lifecycle cover cheap ranks 1–12 (Project Info through
delete contact/identity). Full 10-flow suite not yet re-run in one sitting
after Wave 4 YAML additions.

No iOS Maestro, no CI emulator job, no live-mailbox mail E2E, no GUI↔mobile
interop ([[analysis-hierarchy-gui-e2e-coverage]]).

## Features that still need mobile tests

Mapped against GUI Playwright (`gui/e2e/`). GUI mail specs are all
`test.skip` today; they are still a mobile gap.

### Covered (or attempted) on mobile

- Shell smoke (Identities + More: About, Mail trace, Diagnostics, self-test, Activity log, Settings)
- Mail help screen (no mailbox)
- HD create + publish
- Wrong-password publish
- Push detail + Contacts search
- Export public JSON, emergency cert, fetch contact, local notes, delete contact + identity
- Attached sign + verify
- Detached sign (include-identity OFF) + verify with pasted public keys (`verify-public-keys.yaml`)
- Same-client hierarchy propose/accept/Load Tree

### Still untested on mobile (GUI has the test, or the feature exists)

| Feature | GUI spec | Mobile |
|---------|----------|--------|
| Navigate Project Info / Contacts / Sign / Encrypt | `smoke.spec.ts` | Project Info in smoke; Contacts/Crypto tabs not in smoke |
| Non-HD “Generate Identity” | `creates and publishes a new identity` | `create-random.yaml` (create only; publish covered by identity flow) |
| Detached verify with provided public keys | `verifies detached signature with provided public keys` | `verify-public-keys.yaml` (Wave 4; not yet device-proven) |
| Tampered detached payload | `rejects tampered detached signature payload` | not ported |
| Wrong-sender decrypt | `shows sender validation failure…` | not ported |
| Two-party encrypt/decrypt messages | serial “multi-user encrypted messaging flow” | not ported |
| Signed file encrypt/decrypt | `encrypts and decrypts signed file payloads` | not ported |
| Revoke + re-add detail | `publishes, revokes, and re-adds a detail…` | not ported |
| Revoked identity hidden from search | `revoked identitiy is removed from search results` | not ported |
| Revoked identity blocked from import | `revoked identity is blocked from browse/import…` | not ported |
| Hierarchy loop reject | `rejects a loop when attempting reverse hierarchy` | not ported |
| Mail account/send/decrypt/search/pagination | `mail.spec.ts` (all skipped) | help only (`mail-help.yaml`); no live mailbox |
| GUI ↔ mobile hierarchy | none | none |

**Count:** GUI Playwright has **23 active tests** (6 smoke + 15 identity
including a 5-test serial encrypt/file flow + 2 hierarchy) and **5 skipped
mail tests**. Mobile default suite is **11 flows**; counterpart coverage is
still partial vs GUI (no tamper/encrypt-file/revoke/live-mail). **Hardest
remaining gaps are file pickers / Share** (ranks 25–28) and live mailbox
(29–30). Crypto hub encrypt/decrypt message+file, sign/verify file, and
fingerprint tool still lack Maestro beyond sign/verify message paths.

### Existing mobile features without tests

Of mobile screens, smoke + mail-help + identity/crypto/contacts/hierarchy
flows hit most hubs; **file-picker and Share paths remain untested**.
Counting distinct user operations, ranks 13+ below still need E2E. Ranks
1–12 covered by expanded smoke and contacts-lifecycle (2026-08-24). Mail
help covered by `mail-help.yaml` (2026-09-09).

| Rank | Feature | Why this difficulty |
|------|---------|---------------------|
| ~~1~~ | ~~Project Info~~ | **Covered** by expanded smoke |
| ~~2~~ | ~~Activity log~~ | **Covered** by expanded smoke |
| ~~3~~ | ~~Mail Trace~~ | **Covered** by expanded smoke |
| ~~4~~ | ~~Settings toggles~~ | **Covered** by expanded smoke |
| ~~5~~ | ~~Diagnostics~~ | **Covered** by expanded smoke |
| ~~6~~ | ~~Core self-test~~ | **Covered** by expanded smoke |
| ~~7~~ | ~~Export public JSON~~ | **Covered** by contacts-lifecycle |
| ~~8~~ | ~~Delete from device~~ | **Covered** by contacts-lifecycle |
| ~~9~~ | ~~Emergency certificate~~ | **Covered** by contacts-lifecycle |
| ~~10~~ | ~~Fetch contact by fingerprint~~ | **Covered** by contacts-lifecycle |
| ~~11~~ | ~~Local notes~~ | **Covered** by contacts-lifecycle |
| ~~12~~ | ~~Delete contact~~ | **Covered** by contacts-lifecycle |
| 13 | HD Discover on server | Re-enter mnemonic on Create after publish; assert match count |
| 14 | Revoke detail | Clone `details.yaml`, then revoke + search no longer hits |
| 15 | Import contact JSON | Paste public JSON; huge payload needs clipboard/paste like sign-verify |
| 16 | Fingerprint tool | Same huge JSON; screen has no Paste button yet (add one or copy from export) |
| 17 | Verify email | Publish email detail + server `requestVerifyEmail` |
| 18 | Sync from server | Fetch, change/revoke on server side, Sync, assert details |
| 19 | Reject hierarchy proposal | Clone `hierarchy.yaml` (~4m HD keygen ×2) but tap Reject |
| 20 | Opaque detail resolve | `opaque::` path, fetch contact, resolve with plaintext |
| 21 | Encrypt + decrypt message | Two identities or self-as-contact; clipboard payload; ContactPicker |
| 22 | Revoke identity (search + import blocked) | Publish, revoke, wait, browse/fetch must fail |
| 23 | Hierarchy loop reject | Two proposes + reject; longest same-client cert flow |
| 24 | Signed encrypt + wrong-sender decrypt | Encrypt path plus sender-context assertion |
| 25 | Import identity file | Android document picker (`pick`); Maestro is poor at SAF |
| 26 | Export identity file (Share) | `Share.open` hits OEM Quick Share (already broke Copy in sign-verify) |
| 27 | Sign file + verify file | Document picker both ways |
| 28 | Encrypt file + decrypt file | Picker plus two-party crypto |
| 29 | Mail account setup (manual IMAP/SMTP) | Needs `TEST_EMAIL_*`, TLS, Test button; historically flaky |
| 30 | Inbox, decrypt/read, sender authenticity, compose/send, reply | Depends on a live mailbox and (29); OAuth would add a system browser |

Ranks 1–12 can hang off smoke/identity/details with little new harness.
Ranks 25–28 likely need a test-only inject path (adb push + in-app “load
fixture”) rather than the real picker/Share sheet. Ranks 29–30 need mail
credentials like `gui/e2e/mail.spec.ts` (those GUI tests are skipped today).

## GUI features missing from mobile

[[analysis-gui-mobile-parity-deltas]] still says Parity v1 “must-haves” are
done (wallet, HD, mail, hierarchy). The gaps below are **GUI surfaces that
have no equivalent mobile control**, not the June 2026 interop bugs.

### Identity

1. ~~**Non-HD “Create New Identity”**~~ — **Done** (`RandomCreateScreen` +
   `createRandomIdentity`; Create remains HD; Create random is explicit).
2. ~~**HD change chain**~~ — **Done** (`hd-change` external|internal on
   `HdCreateScreen`).
3. ~~**HD overwrite-if-exists**~~ — **Done** (`hd-overwrite` + Alert confirm).
4. ~~**Selective public export**~~ — **Done** (signing / encryption / details
   switches; password required; both-keys-off blocked).
5. ~~**Opaque toggle on add-detail**~~ — **Done** (`identity-detail-opaque`).
6. ~~**Per-publish / per-fetch server override**~~ — **Done** (publish,
   fetch, and browse optional server fields; empty = Settings URL).

### Crypto

7. ~~**Include-salt toggle on Sign Message**~~ — **done** (2026-09-09):
   `SignMessageScreen` `testID="sign-include-salt"` → `includeSalt`.
8. ~~**Include-salt toggle on Sign File**~~ — **done** (2026-09-09):
   `SignFileScreen` `testID="sign-file-include-salt"` + salt display.
9. ~~**Verify with pasted/imported public keys**~~ — **done** (2026-09-09):
   `VerifyMessageScreen` `verify-use-public-keys` / `verify-public-keys`
   (paste + file import). Deno: `test/mobile-signVerify_parity_test.ts`.
10. **Save JSON to `~/Downloads`** — GUI `POST /api/v1/save-file`. Mobile uses
    the Share sheet (**desktop-only**; intentional).

### Mail

11. ~~**Folder picker**~~ — **done** (2026-09-09): `MailInboxScreen` presets
    (INBOX/Sent/Drafts/Trash/Spam/Custom) + `listMailboxMessages({ folder })`.
    Provider-specific names (e.g. Gmail `[Gmail]/Sent Mail`) use Custom.
12. ~~**Inbox search**~~ — **done** (2026-09-09): IMAP `UID SEARCH TEXT`.
13. ~~**Inbox pagination**~~ — **done** (2026-09-09): Prev/Next with
    `paginateUids` matching GUI math.
14. ~~**Inbox fetch limit**~~ — **done** (2026-09-09): limit 1–100, default 20.
15. ~~**Compose attachments**~~ — **done** (2026-09-09): document picker +
    `multipart/mixed` (plain attachments; encrypted EBP attachments follow-up).
16. ~~**Multi-recipient compose**~~ — **done** (2026-09-09): multi To rows,
    SMTP `RCPT TO` loop, EBP via `signAndEncryptForMany`.
17. ~~**“How to Connect Your Email” help tab**~~ — **done** (2026-09-09):
    `MailHelpScreen` (`testID="mail-help-body"`).
18. ~~**Sandboxed HTML preview**~~ — **done** (2026-09-09): Settings “Render
    HTML” → `react-native-webview` with CSP (`javaScriptEnabled={false}`).
    Encrypted EBP mail stays on the locked reader.

### Desktop-only / out of scope (not expected on phone)

- Shared `~/.ebp/` with the CLI (export/import instead)
- Tauri desktop shell
- GUI `save-file` → `~/Downloads` (mobile Share)
- OAuth email on mobile (manual IMAP/SMTP only)
- Chrome email extension (removed; not a live component)
- iOS Maestro / signed IPA (Android release APK exists;
  [[analysis-mobile-standalone-install]])

### Mobile-only (not missing)

HD **Discover on server**, Diagnostics, Mail Trace, and a dedicated
Fingerprint tool screen exist on mobile and not as matching GUI pages.

## Related

- [[analysis-mobile-e2e-framework]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-parity-roadmap]]
- [[component-mobile]]
- [[component-gui]]

## Sources

- `mobile/e2e/` (smoke, mail-help, identity, create-random, details,
  contacts-lifecycle, sign-verify, verify-public-keys, hierarchy)
- `scripts/mobile-e2e.sh`
- `gui/e2e/{smoke,identity,hierarchy,mail}.spec.ts`
- `gui/index.html` (page sections)
- `mobile/src/navigation/AppNavigator.tsx` and identity/mail/crypto screens
- Maestro debug logs under `~/.maestro/tests/2026-08-17_*`
