---
title: "EBP Mobile Component"
type: component
status: active
last_updated: 2026-07-21
source_count: 4
tags:
  - component
  - mobile
  - react-native
---

# Mobile Component

EBP includes a mobile application built with React Native (`mobile/`). The goal is full feature parity with the [[component-gui|GUI]].

## Current Status

The mobile app implements **Parity v1** with the GUI (wallet, HD, native mail, hierarchy). See [[analysis-mobile-parity-roadmap]] and [[analysis-gui-mobile-parity-deltas]].

## Architecture

- **React Native** with TypeScript (`.tsx` / `.ts` files).
- Imports shared crypto/wire helpers from `core/` via `mobile/src/ebpCore.ts` (payload parsing, sender resolution, file payload builders, password policy).
- App-local storage under `DocumentDirectory/ebp/` (not `~/.ebp/`); see [[analysis-gui-mobile-parity-deltas]].
- Contact normalization (`mobile/src/services/contacts.ts`) strips revoked details from server responses ([[analysis-sync-revoked-details-bug]]).
- Compose resolves To addresses against contact `email` / `opaque::email` details ([[analysis-mobile-compose-recipient-resolve]]).
- Reply from message view prefills compose and, for EBP mail after decrypt, encrypts to the signer identity ([[analysis-mobile-mail-reply]]).

## Parity

See [[analysis-gui-mobile-parity-deltas]] (checklist) and [[analysis-mobile-parity-roadmap]] (phases). Mail stack documented in `mobile/MAIL.md`.

## Related Pages

- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-parity-roadmap]]
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-mail-reply]]
- [[component-gui]]
- [[component-cli]]
- [[identity-model]]
- [[analysis-sync-revoked-details-bug]]
- [[overview]]

## Sources

- `ReadMe.md`
- `mobile/MAIL.md`
