---
title: "EBP Mobile Component"
type: component
status: seed
last_updated: 2026-04-08
source_count: 1
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
- Shares identity and contact data model with the CLI/GUI.
- Contact normalization (`mobile/src/services/contacts.ts`) handles stripping revoked details from fetched server responses (fixed alongside the GUI in [[analysis-sync-revoked-details-bug]]).

## Related Pages

- [[component-gui]]
- [[component-cli]]
- [[identity-model]]
- [[analysis-sync-revoked-details-bug]]
- [[overview]]

## Sources

- `ReadMe.md`
