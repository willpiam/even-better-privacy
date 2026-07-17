---
name: Fix IMAP greeting race
overview: Fix the mobile TCP line client so early IMAP/SMTP greetings are not dropped, accept LF as well as CRLF, and add a per-readLine timeout so Test IMAP + SMTP fails with a clear error instead of hanging forever.
todos:
  - id: fix-tcp-buffer
    content: Rewrite tcpClient flush/pendingLines + LF/CRLF + readLine 30s timeout
    status: completed
  - id: verify-docs
    content: Brief MAIL.md note; confirm stubs still make sense after fix
    status: completed
isProject: false
---

# Fix IMAP greeting race and readLine hang

## Root cause

In [`mobile/src/services/mail/tcpClient.ts`](mobile/src/services/mail/tcpClient.ts), `flushLines()` consumes `\r\n`-terminated lines from `buffer` and only delivers them if a `readLine` waiter exists. If the server sends `* OK…` immediately after TLS connect (before `imap.greeting.wait` calls `readLine`), the greeting is **discarded** and the next `readLine` waits forever. Field stubs on iPage showed exactly: `tcp.connect.ok` → `imap.greeting.wait` (stall).

## Changes (single file focus)

Rewrite the line-buffering in [`tcpClient.ts`](mobile/src/services/mail/tcpClient.ts):

1. **Pending-line queue** — When a complete line is available and there is no waiter, push it to `pendingLines` instead of dropping it. `readLine` drains `pendingLines` first, then the socket buffer, then registers a waiter.

2. **Line endings** — Split on `\r\n` or bare `\n` (strip a trailing `\r` if present). Keep writing with `\r\n`.

3. **`readLine` timeout** — Default **30s** (same as connect). On timeout: emit `tcp.readLine.timeout` via `mailStub`, reject with `TCP readLine timed out`, destroy the socket so the Test button leaves `Testing…` and surfaces the error.

4. **Reject waiters on close/error** — If the socket errors or is destroyed while a `readLine` is pending, reject waiters so callers do not hang after a failed connection mid-read.

Keep existing connect stubs (`tcp.connect.*`). Add stub on read timeout only (avoid stubbing every successful line).

No changes required to `imap.ts` / `smtp.ts` / `mailTest.ts` for the race itself — they already await `readLine` after connect; fixing the buffer is sufficient.

## Verify

1. Reload app → Mail account setup → **Test IMAP + SMTP** against iPage 993.
2. Expect either full pass through `imap.greeting.ok` / login, or a **finite** failure with status text (not indefinite `Testing…`).
3. If it still fails after greeting, Mail trace stubs should advance past `imap.greeting.wait` so the next stall is visible.

## Docs

One-line note under the existing hang section in [`mobile/MAIL.md`](mobile/MAIL.md) or leave as-is (stubs already documented). Prefer a brief mention that early server lines are buffered and `readLine` times out after 30s.
