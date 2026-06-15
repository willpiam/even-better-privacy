---
title: "Mobile Security Audit Scope"
type: analysis
status: active
last_updated: 2026-06-04
source_count: 2
tags:
  - security
  - mobile
  - audit
---

# Mobile Security Audit Scope

The April 2026 audit ([[security-audit-2026-04/README]]) explicitly excluded
`mobile/`. After **Parity v1** implementation, a follow-on mobile review should
cover:

## In scope

- `mobile/src/services/storage.ts` — identity encryption, Argon2 KDF, import/delete
- `mobile/src/services/mail/*` — OAuth tokens, IMAP/SMTP secrets, PIN-encrypted store
- `mobile/src/services/contacts.ts` — opaque detail resolution, server fetch
- Deep link handler `ebp://mail/oauth/callback` (Android/iOS manifests)
- React Native TCP TLS to mail providers
- Shared `core/` crypto invoked from Hermes (noble + native libsodium Argon2)

## Threat focus

| Area | Question |
|------|----------|
| Secrets at rest | Mail secrets envelope vs Keychain-only storage |
| OAuth redirect | State parameter binding, callback hijack via malicious apps |
| Mail TLS | Certificate validation via `react-native-tcp-socket` |
| Clipboard / logs | Activity log and share-sheet leakage of payloads |
| Jailbreak / root | Sandbox `DocumentDirectory/ebp` exposure |

## Suggested tests

- Static review of `mail/accountStore.ts` and `mail/oauth.ts`
- Attempt OAuth state replay and wrong redirect URI against server
- Verify wrong PIN cannot decrypt `mail-account.secrets.json`
- Fuzz IMAP/SMTP parsers in `tcpClient.ts` for buffer growth

## Sources

- [[security-audit-2026-04/README]]
- [[analysis-mobile-parity-roadmap]]
- `mobile/MAIL.md`
