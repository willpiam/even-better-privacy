---
title: "Mobile IMAP/SMTP Inbox Empty and Send Failures"
type: analysis
status: active
last_updated: 2026-07-17
source_count: 8
tags:
  - analysis
  - mobile
  - email
  - imap
  - smtp
  - tls
---

# Mobile IMAP/SMTP Inbox Empty and Send Failures

## Summary

On [[component-mobile]], an empty inbox list and failed sends over manual IMAP/SMTP usually share one of three causes: **mail secrets still locked after process restart**, **TLS mode mismatch** (mobile always opens implicit TLS and ignores `imapSecure`/`smtpSecure`), or **account/credential misconfiguration**. The inbox UI always shows “No messages loaded.” for both a true empty mailbox and a failed load; the status line under Refresh/Compose carries the real error.

**Test IMAP + SMTP** should finish in a few seconds when hosts/ports/credentials match the client. It can hang **indefinitely** with no failure message because only the TCP connect step has a timeout (~30s); IMAP/SMTP `readLine` waits have none.

## Evidence

- [[component-mobile]] / `mobile/MAIL.md`: Parity v1 mail is in-process IMAP/SMTP over `react-native-tcp-socket`; passwords live in an encrypted envelope; after restart you must **Unlock mail secrets** with the email PIN before inbox/compose work.
- `mobile/src/services/mail/accountStore.ts` `resolveSelectedAccount` throws `Mail secrets locked; unlock with PIN first` when secrets are not in memory.
- `mobile/src/services/mail/tcpClient.ts` `connectTlsLineClient` always sets `tls: true` (implicit TLS). `imapSecure` / `smtpSecure` on [[email-transport|account config]] are stored but never passed through.
- `mobile/src/services/mail/smtp.ts` runs `EHLO` → `AUTH LOGIN` with no STARTTLS upgrade. Port **587** submission (plain then STARTTLS) therefore cannot succeed with the current client; port **465** (SMTPS) matches the implicit-TLS path.
- GUI contrast: `gui/local-backend/routes.ts` uses Nodemailer with `secure: account.smtpSecure`, so desktop respects submission vs SMTPS. Mobile does not.
- Inbox screen (`MailInboxScreen.tsx`) maps errors to `status` and clears the list; `ListEmptyComponent` always reads “No messages loaded.”

## Likely failure modes (checklist)

| Symptom / status text | Likely cause | Fix |
|----------------------|--------------|-----|
| `Mail secrets locked; unlock with PIN first` | Secrets encrypted at rest; not unlocked this session | Mail Accounts → Unlock mail secrets (email PIN); then reopen inbox |
| `TCP connection timed out` / socket / TLS errors | Wrong host/port, firewall, or TLS mode mismatch (e.g. SMTP **587** with forced TLS) | Prefer IMAP **993** + SMTP **465** with TLS on; or implement STARTTLS and honor `smtpSecure`/`imapSecure` |
| IMAP/SMTP auth / LOGIN / `535` failures | Wrong password, provider blocks basic auth, username ≠ full email | Use provider **app password**; set username to full address; run **Test IMAP + SMTP** before save |
| `Loaded 0 messages` | Connection + auth succeeded; mailbox empty or SEARCH returned nothing | Verify mail arrives in INBOX on another client; not an unlock/TLS bug |
| Hang / no progress / unlock forever | Native deps missing or Hermes PBKDF2 path | Rebuild after `react-native-tcp-socket` + `react-native-quick-crypto`; Diagnostics → Verify mail PBKDF2 parity |
| Test button stuck on `Testing…`, status blank forever | Connect succeeded (or TLS half-open) then protocol `readLine` never returns; common with SMTP **587** + forced TLS | Prefer **993/465**; cancel by leaving screen / restart app until step timeouts exist |

## Test IMAP + SMTP duration and hang

**Expected (healthy):** roughly **1–5 seconds** total — TLS connect + LOGIN for IMAP, then the same for SMTP. Slow networks or cold TLS may stretch toward **~10s**. Per-connection TCP connect aborts at **30 seconds** (`connectTlsLineClient` default `timeoutMs`).

**Not expected:** sitting on `Testing…` for minutes with an empty status line. That is a hang, not a long test.

### Why there is no failure feedback

- `MailAccountSetupScreen.onTest` only sets `status` in `catch` / success; while awaiting, status is cleared and the button shows `Testing…`.
- `testMailConnection` runs IMAP then SMTP sequentially (`mailTest.ts`).
- After the socket connect callback fires, `readLine()` in `tcpClient.ts` waits forever for `\r\n` — no per-read timeout, no overall test deadline, no cancel.
- A TLS-mode mismatch (e.g. port 587 expecting STARTTLS while the client opens implicit TLS) often passes or stalls past “connected,” then blocks on greeting/AUTH forever — so the 30s connect timeout never fires and the UI never leaves `Testing…`.

Related pattern on desktop: [[analysis-mail-message-load-hang]] (unbounded IMAP/MIME work without abort); mobile’s gap is specifically unbounded line reads after connect.

## Operational steps (no code change)

1. Confirm the status line on the inbox (do not trust “No messages loaded.” alone).
2. On **Mail Accounts**, unlock secrets if the unlock UI is shown.
3. Edit the account: IMAP `host:993` TLS, SMTP `host:465` TLS, app passwords, full-email username.
4. Run **Test IMAP + SMTP** and only then open the inbox / compose.
5. If TCP never connects after a fresh clone: `cd mobile && npm install`, rebuild native (`npm run android` / `ios`), restart Metro with `--reset-cache` (`mobile/MAIL.md`).

## Code gaps (recommended fixes)

1. **Honor `imapSecure` / `smtpSecure`:** connect with `tls: config.*Secure` for implicit TLS; when secure is false, open plain TCP, issue `STARTTLS`, then upgrade (SMTP 587 / IMAP 143).
2. **Surface locked-secrets on the inbox** with a button to navigate to unlock, instead of only a status string.
3. **Distinguish empty vs error** in `ListEmptyComponent` (e.g. show the error, or “Inbox empty” only when `Loaded 0 messages`).
4. **Bound every `readLine` / test step** (e.g. 15–30s) and an overall test deadline; on timeout destroy the socket and surface `IMAP timed out waiting for greeting` / `SMTP AUTH timed out` (or similar) into `status`.
5. **Show step progress** during test (`Connecting IMAP…`, `Authenticating SMTP…`) so a hang is attributable without waiting for a missing catch.

## Related Pages

- [[component-mobile]]
- [[email-transport]]
- [[analysis-mobile-parity-roadmap]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mail-message-load-hang]] (GUI selected-message hang; different bug)

## Sources

- `mobile/MAIL.md`
- `mobile/src/services/mail/tcpClient.ts`
- `mobile/src/services/mail/imap.ts`
- `mobile/src/services/mail/smtp.ts`
- `mobile/src/services/mail/mailTest.ts`
- `mobile/src/services/mail/accountStore.ts`
- `mobile/src/screens/mail/MailInboxScreen.tsx`
- `mobile/src/screens/mail/MailAccountSetupScreen.tsx`
- `gui/local-backend/routes.ts` (Nodemailer `secure` contrast)
