---
title: "EBP Mobile Component"
type: component
status: active
last_updated: 2026-10-20
source_count: 6
tags:
  - component
  - mobile
  - react-native
---

# Mobile Component

EBP includes a mobile application built with React Native (`mobile/`). The goal is full feature parity with the [[component-gui|GUI]].

## Current Status

The mobile app implements **Parity v1** with the GUI (wallet, HD, native mail, hierarchy). Finish-line Waves 1–2 closed remaining identity/crypto/mail control gaps on Android (2026-09-09). See [[analysis-mobile-parity-roadmap]] and [[analysis-gui-mobile-parity-deltas]].

**Intentional non-parity:** OAuth email out of scope (manual IMAP/SMTP); Downloads/`~/Downloads` desktop-only (Share on device). Chrome email extension removed (not a live component).

Crypto UI parity (2026-09-09): include-salt on Sign Message/File, verify-with-public-keys, decrypt/fingerprint paste, decrypt-file Share. Pure helpers in `mobile/src/services/signVerifyLogic.ts`; Deno tests in `test/mobile-signVerify_parity_test.ts`. Maestro: `sign-verify.yaml`, `verify-public-keys.yaml`.

Identity UI parity (2026-09-09): random-key create, HD change/overwrite, selective public export, opaque add-detail, per-action server override. Helpers in `mobile/src/services/identity.ts`; Maestro `create-random.yaml`.

Mail UI parity (2026-09-09): folder/search/page/limit, help screen, HTML WebView, attachments, multi-recipient. Maestro: `mail-help.yaml` (no live mailbox). Remaining untested paths (file pickers, live IMAP): [[analysis-mobile-testing-and-gui-gaps]].

**Get started** (2026-10-20): `OnboardingWizardScreen` from the empty Identities home and from Mail accounts. It creates an [[ebp-hd]] identity and a managed mailbox via `services/mail/ebpSignup.ts`. Maestro: `mobile/e2e/onboarding.yaml` (through the create step; mailbox provisioning expects a mail-server error when Stalwart is unreachable). See [[analysis-ebp-managed-email-onboarding]].

## Architecture

- **React Native** with TypeScript (`.tsx` / `.ts` files).
- Imports shared crypto/wire helpers from `core/` via `mobile/src/ebpCore.ts` (payload parsing, sender resolution, file payload builders, password policy).
- App-local storage under `DocumentDirectory/ebp/` (not `~/.ebp/`); see [[analysis-gui-mobile-parity-deltas]].
- Contact normalization (`mobile/src/services/contacts.ts`) strips revoked details from server responses ([[analysis-sync-revoked-details-bug]]).
- Compose resolves To addresses against contact `email` / `opaque::email` details ([[analysis-mobile-compose-recipient-resolve]]).
- Reply from message view prefills compose and, for EBP mail after decrypt, encrypts to the signer identity ([[analysis-mobile-mail-reply]]).

## Parity

See [[analysis-gui-mobile-parity-deltas]] (checklist) and [[analysis-mobile-parity-roadmap]] (phases). Mail stack documented in `mobile/MAIL.md`. Android Maestro E2E: [[analysis-mobile-e2e-framework]] (`deno task test:e2e:mobile`).

## Related Pages

- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-parity-roadmap]]
- [[analysis-mobile-e2e-framework]]
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[analysis-mobile-compose-recipient-resolve]]
- [[analysis-mobile-encrypted-mail-reader-ux]]
- [[analysis-mobile-mail-reply]]
- [[analysis-ebp-managed-email-onboarding]]
- [[component-gui]]
- [[component-cli]]
- [[identity-model]]
- [[analysis-sync-revoked-details-bug]]
- [[overview]]

## Sources

- `ReadMe.md`
- `mobile/MAIL.md`
- `mobile/e2e/README.md`
- [[analysis-mobile-e2e-framework]]
