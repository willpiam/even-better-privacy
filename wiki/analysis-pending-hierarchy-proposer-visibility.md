---
title: "Pending hierarchy proposals: proposer visibility"
type: analysis
status: active
last_updated: 2026-07-28
source_count: 4
tags:
  - analysis
  - hierarchy
  - server
  - gui
  - mobile
---

# Pending hierarchy proposals: proposer visibility

## Verdict

**"Pending Proposals" is for the counterparty, not the creator.** An identity
that creates a hierarchy proposal should **not** see that proposal in its own
Pending Proposals section. That section lists proposals that involve the current
identity as master or child **and** were created by a different identity —
i.e. items awaiting this identity's accept/reject.

## Intended semantics

1. Identity A proposes a master↔child relationship involving A and B.
2. The row is stored in `pending_hierarchy_proposals` with
   `proposer_fingerprint = A`.
3. When B fetches pending proposals for B's fingerprint, the proposal appears
   (B is master or child, and is not the proposer).
4. When A fetches pending for A's fingerprint, the same row is **excluded**.
5. A cannot accept or reject its own pending entry; B (or the other party) acts.

This matches the GUI E2E flow: propose as one identity, switch to the other to
see Accept/Reject ([[analysis-hierarchy-gui-e2e-coverage]]).

## Evidence in code

| Layer | Behavior |
|---|---|
| Server DB | `getPendingProposalsForIdentity` uses `(master OR child) AND proposer != fingerprint` |
| Server API | `GET /api/v1/hierarchy/pending/:fingerprint` returns that filtered set ([[component-server]]) |
| GUI local | Same filter when listing pending for the current identity |
| Mobile | `listPending` applies the same filter |
| Accept/reject | Explicit errors if the caller is the proposer |

Ops dump `deno task query:prod:proposals` / `list-proposals.ts` shows **all**
rows (including proposer-owned); that is a full-table inspect tool, not the
app pending-list semantics ([[analysis-querying-live-key-server-db]]).

## Wiki gap

[[component-server]] documents the pending endpoint but not this
proposer-exclusion rule. No dedicated hierarchy concept page spells out the
UX contract.

## Related

- [[component-server]]
- [[component-gui]]
- [[component-mobile]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-querying-live-key-server-db]]

## Sources

- `server/db/index.ts` (`getPendingProposalsForIdentity`)
- `server/handlers/hierarchy.ts` (`handleGetHierarchyPending`)
- `gui/local-backend/routes.ts` (pending list filter; proposer cannot accept/reject)
- `mobile/src/services/hierarchy.ts` (`listPending`)
