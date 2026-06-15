---
title: "Mobile Parity Roadmap"
type: analysis
status: active
last_updated: 2026-06-04
source_count: 4
tags:
  - analysis
  - mobile
  - gui
  - parity
  - roadmap
---

# Mobile Parity Roadmap

Phased plan to reach **Parity v1** with [[component-gui]] (see checklist in
[[analysis-gui-mobile-parity-deltas]]). Wire-format interop and native Argon2
are complete; this page tracks feature delivery.

## Phases

| Phase | Scope | Status |
|-------|--------|--------|
| 0 | Parity contract (wiki checklist) | done |
| 1 | Wallet, contacts UX, settings, hierarchy tree | done |
| 2 | [[ebp-hd]] mnemonic derive + discover | done |
| 3 | Full in-app mail (IMAP/SMTP/OAuth/EBP compose) | done |
| 4 | Interop tests, mobile audit notes, README | done |

## Phase 1 deliverables

- Identity import/export/delete (`mobile/src/services/storage.ts`)
- Contact opaque resolve, local notes, verify-email (`contacts.ts`, screens)
- Sign confirmation, expanded settings, diagnostic log
- Hierarchy tree merge (`hierarchy.ts`, `CertificatesScreen.tsx`)

## Phase 2 deliverables

- `mobile/src/services/hd.ts`, `HdCreateScreen.tsx`
- Vectors: `core/tests/fixtures/ebp-hd/test-vectors.json`

## Phase 3 deliverables

- `mobile/src/services/mail/*` — accountStore, oauth, imap, smtp, mime, ebpMail
- `mobile/src/screens/mail/*` — accounts, inbox, message, compose
- Library choice: [[mobile/MAIL.md]]

## Phase 4 deliverables

- `test/mobile-parity_test.ts`, extended interop fixtures
- `wiki/security-audit-2026-04/mobile-scope.md` — mobile audit scope note

## Out of scope (Parity v1)

- Tauri desktop shell ([[component-desktop]])
- Chrome extension localhost API ([[component-email-extension]])
- Shared `~/.ebp/` path on device (export/import instead)

## Sources

- [[analysis-gui-mobile-parity-deltas]]
- [[component-mobile]]
- [[component-gui]]
- `.cursor/plans/mobile_gui_parity_fa88bc31.plan.md` (implementation plan; not wiki)
