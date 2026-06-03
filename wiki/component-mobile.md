---
title: "EBP Mobile Component"
type: component
status: active
last_updated: 2026-06-02
source_count: 4
tags:
  - component
  - mobile
  - react-native
---

# Mobile Component

EBP includes a mobile application built with React Native (`mobile/`). The goal is full feature parity with the [[component-gui|GUI]].

## Current Status

The mobile app exists in the repository with ~80+ source files and is under active development. Full feature parity with the GUI is listed as an upcoming milestone in the README.

## Architecture

- **React Native** with TypeScript (`.tsx` / `.ts` files).
- Imports shared crypto/wire helpers from `core/` via `mobile/src/ebpCore.ts` (payload parsing, sender resolution, file payload builders, password policy).
- App-local storage under `DocumentDirectory/ebp/` (not `~/.ebp/`); see [[analysis-gui-mobile-parity-deltas]].
- Contact normalization (`mobile/src/services/contacts.ts`) strips revoked details from server responses ([[analysis-sync-revoked-details-bug]]).

## Parity

See [[analysis-gui-mobile-parity-deltas]] for a capability-by-capability comparison with the [[component-gui]] (missing features vs format drift).

## Related Pages

- [[analysis-gui-mobile-parity-deltas]]
- [[component-gui]]
- [[component-cli]]
- [[identity-model]]
- [[analysis-sync-revoked-details-bug]]
- [[overview]]

## Sources

- `ReadMe.md`
