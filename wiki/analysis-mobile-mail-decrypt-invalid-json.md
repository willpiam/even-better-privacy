---
title: "Mobile Mail Decrypt: Invalid JSON Payload"
type: analysis
status: active
last_updated: 2026-07-20
source_count: 8
tags:
  - analysis
  - mobile
  - email
  - decrypt
  - mime
  - bug
---

# Mobile Mail Decrypt: Invalid JSON Payload

## Summary

On [[component-mobile]], tapping **Decrypt EBP body** can fail with `Invalid JSON payload` even when the identity password is correct and the same message decrypts on [[component-gui|desktop]]. The password is a red herring: that error is thrown by `parseEbpPayloadInput` **before** any identity unlock or ML-KEM decrypt runs. The failure is that mobile treats a raw MIME substring as an EBP armor block without the MIME decode path the GUI uses.

## Resolution (2026-07-20)

Fixed in mobile without adding `mailparser`:

1. `mobile/src/services/mail/mime.ts` walks multipart MIME, decodes `quoted-printable` / `base64` CTE, then runs `extractArmoredPayload` on decoded `text/plain` (then html). On success it returns a clean `armorPayload(parsed)` string.
2. Marker-only fallback removed — `ebpPayload` is null unless JSON inside the armor parses.
3. `decryptMailBody` distinguishes missing armor vs markers present but unparseable (`Could not parse EBP armor (message may need MIME decode)`).
4. Regression tests: `mobile/__tests__/mimeDecode-test.ts` (7bit multipart, QP soft breaks, base64, corrupt markers).

## Symptom → cause

| Observation | Meaning |
|-------------|---------|
| UI shows “EBP payload detected” then decrypt fails with `Invalid JSON payload` | Markers `-----BEGIN EBP` / `-----END EBP` were found, but the bytes between them are not parseable JSON (or armor parse failed and the whole string was fed to `JSON.parse`) |
| Correct identity password | Unused for this error; failure is earlier than `decryptMessage` / AES |
| Desktop decrypt works for the same mail | GUI extracts armor from **decoded** text/HTML via mailparser (`simpleParser`), then `extractArmoredPayload` |

## Evidence

- `Invalid JSON payload` is thrown only in `core/PayloadInput.ts` when armor extraction returns null and `JSON.parse(trimmed)` fails.
- Mobile mail decrypt (`mobile/src/services/mail/ebpMail.ts`) does: fetch RFC822 → `parseEbpPayloadInput(detail.ebpPayload)` → `decryptMessage(...)`. Password is passed only into `decryptMessage`.
- **Before the fix**, mobile set `ebpPayload` via `extractEbpPayloadFromMime` which could return a marker slice even when `extractArmoredPayload` failed.
- GUI contrast ([[message-payload-formats]], [[analysis-mail-message-load-hang]]): `GET /api/v1/mail/message` parses full MIME with `simpleParser`, then `extractEbpPayload(textBody || htmlBody)` which is `extractArmoredPayload` on decoded body text — CTE (quoted-printable / base64) and multipart structure are handled by the parser.

## Likely failure modes (checklist)

| Situation | Why mobile broke (pre-fix) | Desktop |
|-----------|------------------------------|--------|
| Body part is `Content-Transfer-Encoding: quoted-printable` with soft breaks (`=\r\n`) inside the JSON | Raw slice still has `=` soft-breaks; `JSON.parse` fails | mailparser decodes QP first |
| Body part is `base64` CTE | Armor markers may appear only after decode, or base64 alphabet pollutes the slice | Decoded before extract |
| Multipart / HTML wrappers leave extra noise between markers | Less common if markers are intact; QP/base64 more likely | Parser yields clean text part |
| Truncated END-line slice (`end + 20` fallback when no `\n` after END) | Incomplete armor end marker → extract fails → `JSON.parse` on whole block | Uses full END constant match |

Wrong password would surface later as identity-decrypt / AEAD failure, not this string.

## Related Pages

- [[component-mobile]]
- [[component-gui]]
- [[message-payload-formats]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-encrypted-mail-reader-ux]] (reader layout; separate from MIME decode)
- [[analysis-mobile-imap-smtp-inbox-empty]]
- [[analysis-mail-message-load-hang]]
- [[email-transport]]

## Sources

- `core/PayloadInput.ts`
- `core/Payloads.ts` (`extractArmoredPayload`, armor markers)
- `mobile/src/services/mail/mime.ts` (`extractEbpPayloadFromMime`)
- `mobile/src/services/mail/ebpMail.ts` (`decryptMailBody`)
- `mobile/src/screens/mail/MailMessageScreen.tsx`
- `mobile/src/services/mail/imap.ts` (`fetchMessageDetail`)
- `gui/local-backend/mail-imap.ts` (`extractEbpPayload`)
- `gui/local-backend/routes.ts` (message detail + `simpleParser` path)
- [[message-payload-formats]]
- [[analysis-gui-mobile-parity-deltas]]
