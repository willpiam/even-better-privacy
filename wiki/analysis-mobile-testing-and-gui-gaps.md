---
title: "Mobile Testing Status and GUI Feature Gaps"
type: analysis
status: active
last_updated: 2026-08-24
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
[[analysis-gui-mobile-parity-deltas]] (Parity v1 checklist, last updated
2026-06-04).

## Mobile E2E: how many pass

Default suite is **7 Maestro flows** (`deno task test:e2e:mobile`):

| Flow | Coverage | Last known result |
|------|----------|-------------------|
| `smoke.yaml` | Launch, More (About, Mail trace, Diagnostics, self-test, Activity log, Settings) | **Passed** (2026-08-24) |
| `identity.yaml` | HD create, set server, wrong-password publish, successful publish | **Passed** (2026-08-17) |
| `details.yaml` | HD create + publish, push email detail, Contacts browse/search | **Passed** (2026-08-17) |
| `contacts-lifecycle.yaml` | Export public JSON, emergency cert, fetch, notes, delete contact + identity | **Passed** (2026-08-24, ~3m 30s) |
| `sign-verify.yaml` | Sign attached message, paste payload, verify | **Passed** (2026-08-24) |
| `hierarchy.yaml` | Two HD identities, propose/accept, Load Tree | **Passed** (2026-08-17) |

Smoke and contacts-lifecycle cover cheap ranks 1–12 (Project Info through
delete contact/identity). Default suite is 7 flows (smoke listed once above);
full suite not yet re-run in one sitting after the new flows.

No iOS Maestro, no CI emulator job, no mail E2E, no GUI↔mobile interop
([[analysis-hierarchy-gui-e2e-coverage]]).

## Features that still need mobile tests

Mapped against GUI Playwright (`gui/e2e/`). GUI mail specs are all
`test.skip` today; they are still a mobile gap.

### Covered (or attempted) on mobile

- Shell smoke (Identities + More: About, Mail trace, Diagnostics, self-test, Activity log, Settings)
- HD create + publish
- Wrong-password publish
- Push detail + Contacts search
- Export public JSON, emergency cert, fetch contact, local notes, delete contact + identity
- Attached sign + verify
- Same-client hierarchy propose/accept/Load Tree

### Still untested on mobile (GUI has the test, or the feature exists)

| Feature | GUI spec | Mobile |
|---------|----------|--------|
| Navigate Project Info / Contacts / Sign / Encrypt | `smoke.spec.ts` | Project Info in smoke; Contacts/Crypto tabs not in smoke |
| Non-HD “Generate Identity” | `creates and publishes a new identity` | N/A — no such UI |
| Detached verify with provided public keys | `verifies detached signature with provided public keys` | not ported |
| Tampered detached payload | `rejects tampered detached signature payload` | not ported |
| Wrong-sender decrypt | `shows sender validation failure…` | not ported |
| Two-party encrypt/decrypt messages | serial “multi-user encrypted messaging flow” | not ported |
| Signed file encrypt/decrypt | `encrypts and decrypts signed file payloads` | not ported |
| Revoke + re-add detail | `publishes, revokes, and re-adds a detail…` | not ported |
| Revoked identity hidden from search | `revoked identitiy is removed from search results` | not ported |
| Revoked identity blocked from import | `revoked identity is blocked from browse/import…` | not ported |
| Hierarchy loop reject | `rejects a loop when attempting reverse hierarchy` | not ported |
| Mail account/send/decrypt/search/pagination | `mail.spec.ts` (all skipped) | no device E2E |
| GUI ↔ mobile hierarchy | none | none |

**Count:** GUI Playwright has **23 active tests** (6 smoke + 15 identity
including a 5-test serial encrypt/file flow + 2 hierarchy) and **5 skipped
mail tests**. Mobile has a counterpart for about **6** (partial smoke, HD
publish, details search, wrong-password, attached sign/verify, hierarchy happy
path). **~17 GUI cases plus all mail paths have no mobile E2E.** Crypto hub
screens that exist on device (encrypt/decrypt message+file, sign/verify file,
fingerprint tool) also have no Maestro flow.

### Existing mobile features without tests

Of **28** mobile screens, **16** are hit by Maestro and **12** have no flow.
Counting distinct user operations, **~18 existing mobile features still need
E2E** (ranks 13+ below). Ranks 1–12 covered by expanded smoke and
contacts-lifecycle (2026-08-24).

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

1. **Non-HD “Create New Identity”** — GUI `#generate-form` (random keys +
   Dilithium/SPHINCS+). Mobile **Create** only opens `HdCreateScreen`.
2. **HD change chain** — GUI `#hd-change` (external vs internal/recovery).
   Mobile always derives `change: 'external'`.
3. **HD overwrite-if-exists** — GUI checkbox; mobile service supports
   `overwrite` but the screen does not expose it.
4. **Selective public export** — GUI checkboxes for signing key / KEM key /
   details. Mobile export is a single public JSON + Share of the full wallet
   file.
5. **Opaque toggle on add-detail** — GUI `#detail-opaque`. Mobile hashes if
   the path starts with `opaque::` but has no checkbox.
6. **Per-publish / per-fetch server override** — GUI `#publish-server`,
   `#fetch-server`, `#server-identities-override`. Mobile uses Settings server
   URL only (browse pagination itself exists).

### Crypto

7. **Include-salt toggle on Sign Message** — GUI `#sign-include-salt`. Mobile
   always salts (`includeSalt` defaults true, no switch).
8. **Verify with pasted/imported public keys** — GUI
   `#verify-use-public-keys` + file import. Mobile verify has payload +
   optional detached message only (`FingerprintToolScreen` is separate).
9. **Save JSON to `~/Downloads`** — GUI `POST /api/v1/save-file`. Mobile uses
   the Share sheet.

### Mail

10. **Folder picker** — GUI Sent/Drafts/Trash/Spam/custom. Mobile inbox is
    INBOX only (`listInboxMessages`, limit 40).
11. **Inbox search** — GUI `#mail-search`.
12. **Inbox pagination** — GUI `#mail-pagination`.
13. **Compose attachments** — GUI `#mail-compose-attachments`. Mobile compose
    has no attachment picker.
14. **Multi-recipient compose** — GUI `#mail-compose-add-recipient`. Mobile
    is a single To field.
15. **“How to Connect Your Email” help tab** — GUI mail help panel.
16. **Sandboxed HTML iframe preview** — GUI `#mail-message-html-frame`.
    Mobile has a “Render HTML mail bodies” setting, not the same reader.

### Desktop-only (not expected on phone)

- Shared `~/.ebp/` with the CLI (export/import instead)
- Tauri desktop shell and Chrome extension localhost API
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

- `mobile/e2e/` (smoke, identity, details, sign-verify, hierarchy)
- `scripts/mobile-e2e.sh`
- `gui/e2e/{smoke,identity,hierarchy,mail}.spec.ts`
- `gui/index.html` (page sections)
- `mobile/src/navigation/AppNavigator.tsx` and identity/mail/crypto screens
- Maestro debug logs under `~/.maestro/tests/2026-08-17_*`
