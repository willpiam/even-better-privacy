---
title: "Mail Message Selection Can Hang"
type: analysis
status: active
last_updated: 2026-04-27
source_count: 5
tags:
  - gui
  - email
  - imap
  - performance
  - bug
---

# Mail Message Selection Can Hang

## Summary

The native GUI inbox can load normally while individual message selection appears to hang because those two paths do very different work. The inbox list uses `GET /api/v1/mail/messages` to fetch only IMAP envelope metadata, flags, dates, and sizes. Selecting a message uses `GET /api/v1/mail/message`, which opens an IMAP connection, fetches the full RFC 5322/MIME source with `source: true`, parses it with `simpleParser`, extracts EBP payload markers, and maps all MIME attachments.

This makes selected-message latency depend on full-message size, attachment size, IMAP provider behavior, OAuth refresh latency, and local MIME parsing cost rather than the much cheaper inbox-list fetch.

## Evidence

- [[component-gui]] describes the GUI as a local backend plus JS frontend, with native email directly using SMTP/IMAP.
- [[email-transport]] notes that IMAP supports selective fetches of message text and MIME parts, but EBP currently fetches the RFC 5322/MIME message before extracting EBP payloads.
- [[message-payload-formats]] documents that `GET /api/v1/mail/message` parses full MIME source and extracts EBP body/attachment payloads on receipt.
- `gui/local-backend/routes.ts` implements `/api/v1/mail/messages` with envelope-only fetch options, while `/api/v1/mail/message` calls `imap.fetchOne(..., { source: true })` and then `simpleParser(one.source)`.
- `gui/js/mail.js` starts a message-detail request on click and ignores stale responses using `mailMessageLoadRequestId`, but it does not abort earlier HTTP requests. The shared `api()` helper in `gui/js/ui.js` uses plain `fetch()` without a timeout or abort signal.

## Why It Is Inconsistent

The inconsistent behavior is expected from the current implementation:

- Small messages with no large attachments can load immediately.
- Large MIME messages or messages with attachments require full source download and parsing before the UI can render.
- Provider-side IMAP stalls can sit behind the backend's long inactivity timeout.
- Rapidly selecting messages can leave previous full-message fetches running on the backend even after the frontend has decided to ignore their responses.
- OAuth accounts may add token-refresh latency before connecting to IMAP.

## Likely Fix Direction

The most direct fix is to make selected-message loading cancelable and bounded: use an `AbortController` in the frontend, abort the previous message-detail request when a new message is selected, and add a visible timeout/error state.

Backend-side improvements would further reduce stalls: fetch body structure or text parts first, defer attachment content parsing until the user opens or decrypts an attachment, and use shorter operation-specific timeouts around full-message fetch and MIME parsing.

## Sources

- [[component-gui]]
- [[email-transport]]
- [[message-payload-formats]]
- `gui/js/mail.js`
- `gui/js/ui.js`
- `gui/local-backend/routes.ts`
- `gui/local-backend/mail-imap.ts`
