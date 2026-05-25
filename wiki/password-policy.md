---
title: "EBP Password Policy"
type: concept
status: active
last_updated: 2026-05-24
source_count: 3
tags:
  - password
  - identity
  - storage
  - security
---

# EBP Password Policy

Identity private keys in [[identity-model]] are encrypted at rest with AES-256-GCM
under a key derived from the user's password (PBKDF2-HMAC-SHA256, 310,000
iterations in `core/AES.ts`). The password policy reduces the risk that a stolen
`~/.ebp/<name>.identity.json` file can be brute-forced quickly.

## Default rules

Enforced by `validatePassword()` in `core/PasswordPolicy.ts` when policy
enforcement is on (the default):

| Rule | Requirement |
|------|-------------|
| **Length** | At least **12** characters |
| **Character classes** | At least **3 of 4**: lowercase, uppercase, digits, symbols (non-alphanumeric) |
| **Blocklist** | Rejected if the normalized password matches a small embedded common-password set |

**Normalization for the blocklist:** trim → lowercase → strip non-alphanumeric
characters → compare to the set (e.g. `password123`, `1234567890`,
`correcthorsebatterystaple`).

**Strength score:** `scorePasswordStrength()` returns 0–4 from length, class
mix, and estimated entropy. The score is informational; only the three rules
above gate acceptance.

**Example passwords (from tests):**

- Accepts: `Correct-Horse-Battery-Staple-9!`
- Rejects: `Short-1!` (too short)
- Rejects: `password123` (blocklisted)
- Rejects: `alllowercasepassword` (only one character class)

Failed validation returns the reason
`Password does not meet the EBP password policy.` plus `suggestions` strings
(e.g. minimum length, class mix).

## Where enforcement applies

| Surface | Policy enforced? |
|---------|------------------|
| [[component-cli]] `ebp identity generate` | Yes (always) |
| [[component-cli]] HD identity flows | Yes (always) |
| [[component-gui]] `POST /api/v1/identity/generate` | Yes by default; optional opt-out (below) |
| [[component-gui]] `POST /api/v1/hd/identity` | Yes by default; optional opt-out (below) |
| Unlocking / signing / decrypting existing identities | No (any password that decrypts the file) |

Implementation entry points: `cli/commands/identity.ts`, `cli/commands/hd.ts`,
`gui/local-backend/routes.ts`.

## GUI opt-out

The [[component-gui]] **Settings → Identity** checkbox
**Enforce password policy when creating identities** (default: on) is stored in
browser `localStorage` under `ebp.identity.enforcePasswordPolicy`. When
unchecked, identity-creation API calls send `enforcePasswordPolicy: false` and the
backend accepts any non-empty password.

This is a **local convenience** for advanced users who accept weaker offline
guessing resistance. It does not change CLI behavior. Any client can send
`enforcePasswordPolicy: false` to the local backend; treat that as intentional
only on trusted machines.

## Audit history

April 2026 audit finding **F-STORAGE-09** documented an 8-character floor only
(see [[security-audit-2026-04/phase-07-storage]]). Remediation added
`core/PasswordPolicy.ts` with the 12-character / 3-of-4 / blocklist rules
(fixed 2026-04-29). Offline brute-force cost also depends on PBKDF2 iteration
count (**F-STORAGE-02**); weak passwords remain risky even when policy is
disabled.

## Related pages

- [[identity-model]]
- [[key-management]]
- [[component-gui]]
- [[component-cli]]
- [[security-audit-2026-04/phase-07-storage]]

## Sources

- `core/PasswordPolicy.ts`
- `test/PasswordPolicy_test.ts`
- `wiki/security-audit-2026-04/phase-07-storage.md` (F-STORAGE-09)
