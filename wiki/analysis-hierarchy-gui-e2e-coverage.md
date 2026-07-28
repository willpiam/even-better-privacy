---
title: "Hierarchy GUI E2E Coverage"
type: analysis
status: active
last_updated: 2026-07-27
source_count: 4
tags:
  - analysis
  - hierarchy
  - gui
  - mobile
  - testing
  - e2e
---

# Hierarchy GUI E2E Coverage

What automated tests cover hierarchy propose/accept flows for [[component-gui]]
and [[component-mobile]], and what is still untested.

## Verdict

**Yes — GUI-to-GUI hierarchy setup is covered by Playwright E2E.** There is
**no** automated cross-client (GUI ↔ mobile) hierarchy proposal/load test.

## GUI E2E (exists)

File: `gui/e2e/hierarchy.spec.ts` (Playwright).

| Test | What it exercises |
|------|-------------------|
| `establishes a hierarchy and renders it in the contact hierarchy tree` | Create two identities in one GUI session, publish both to the test server, propose as master, accept as child (switch identity), fetch contact, **View Hierarchy** — asserts SVG tree with 2 nodes |
| `rejects a loop when attempting reverse hierarchy relationship` | Forward accept succeeds; reverse propose appears pending; reject clears it |

Helpers drive the real Certificates UI: role radio (`#certificate-role-master` /
`#certificate-role-child`), other fingerprint, Propose Certificate, pending
Accept/Reject, password modal.

This is the automated answer to “can the GUI set up a hierarchical relationship
between two identities?” — **yes, for two identities maintained in the same GUI
against a local test server** (`http://localhost:8788`).

## Not covered

| Flow | Status |
|------|--------|
| GUI propose → mobile see/accept pending | no automated test |
| Mobile propose → GUI see/accept pending | no automated test |
| Loading established hierarchy tree GUI ↔ mobile | no automated interop E2E |
| Mobile Certificates UI propose/accept E2E | no Maestro/Detox (or similar) suite found |

Parity analyses note hierarchy **feature** parity and hex encoding alignment
([[analysis-gui-mobile-parity-deltas]], [[analysis-mobile-certificates-ux]]) but
do not claim cross-client E2E.

## Related lower-level tests

| File | Scope |
|------|--------|
| `test/HierarchyCertificate_test.ts` | Crypto: hierarchy cert signing / F-CRYPTO-07 canonical payload |
| `test/mobile-parity_test.ts` | Mobile tree builder merges edges only — not propose/accept UI or server round-trip |

## Implications for GUI ↔ mobile loading bugs

If proposals created on one client do not appear on the other, the existing GUI
E2E will **not** catch that: it never leaves the GUI process or exercises mobile
pending-fetch / certificate decode paths. Debugging should focus on server
pending endpoints ([[component-server]] hierarchy routes), certificate hex
encoding, and each client’s pending-list sync — not on absence of the GUI-only
happy path.

## Related

- [[component-gui]]
- [[component-mobile]]
- [[component-server]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-certificates-ux]]

## Sources

- `gui/e2e/hierarchy.spec.ts`
- `test/HierarchyCertificate_test.ts`
- `test/mobile-parity_test.ts`
- [[analysis-gui-mobile-parity-deltas]]
