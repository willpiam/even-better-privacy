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

Default suite is **5 Maestro flows** (`deno task test:e2e:mobile`):

| Flow | Coverage | Last known result (Android USB, 2026-08-17) |
|------|----------|-----------------------------------------------|
| `smoke.yaml` | Launch, Identities tab, More → Settings | **Passed** (15:46 full 3-flow run) |
| `identity.yaml` | HD create, set server, wrong-password publish, successful publish | **Passed** (16:17, including wrong-password) |
| `details.yaml` | HD create + publish, push email detail, Contacts browse/search | **Passed** (17:14, as a 2-flow pair with sign-verify) |
| `sign-verify.yaml` | Sign attached message, paste payload, verify | **Passed** (2026-08-24, ~2m 19s) |
| `hierarchy.yaml` | Two HD identities, propose/accept, Load Tree | **Passed** (15:46 full 3-flow run) |

The **5-flow suite has not been re-run in one sitting** since sign-verify
went green. Smoke, identity, details, sign-verify, and hierarchy have each
passed independently.

No iOS Maestro, no CI emulator job, no mail E2E, no GUI↔mobile interop
([[analysis-hierarchy-gui-e2e-coverage]]).

## Features that still need mobile tests

Mapped against GUI Playwright (`gui/e2e/`). GUI mail specs are all
`test.skip` today; they are still a mobile gap.

### Covered (or attempted) on mobile

- Shell smoke (partial: Identities + Settings only)
- HD create + publish
- Wrong-password publish
- Push detail + Contacts search
- Attached sign + verify (**flow exists, not green**)
- Same-client hierarchy propose/accept/Load Tree

### Still untested on mobile (GUI has the test, or the feature exists)

| Feature | GUI spec | Mobile |
|---------|----------|--------|
| Navigate Project Info / Contacts / Sign / Encrypt | `smoke.spec.ts` | not in smoke |
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

**Count:** of the **18 active GUI Playwright tests**, mobile has a counterpart
for about **5** (smoke-ish, publish, details search, wrong-password, hierarchy
happy path). **~13 GUI cases plus all mail and encrypt/file/revoke paths have
no mobile E2E.** Crypto hub screens that exist on device (encrypt/decrypt
message+file, sign/verify file, fingerprint tool) also have no Maestro flow.

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
6. **Per-publish server override** — GUI `#publish-server`. Mobile uses
   Settings server URL only.

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
