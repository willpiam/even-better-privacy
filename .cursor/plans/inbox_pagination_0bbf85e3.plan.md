---
name: Inbox Pagination
overview: Add page-based pagination to the inbox by extending the backend `/api/v1/mail/messages` endpoint with a `page` param and adding Prev/Next controls in the frontend, following the existing server-identities pagination pattern.
todos:
  - id: backend-pagination
    content: Add page param and pagination metadata to /api/v1/mail/messages endpoint
    status: completed
  - id: frontend-state
    content: Add mailPagination state, loadMailMessages helper, renderMailPagination in app.js
    status: completed
  - id: html-pagination
    content: Add Prev/Next pagination controls after the message list in index.html
    status: completed
  - id: e2e-pagination
    content: Add mock-based e2e test for inbox pagination in mail.spec.ts
    status: completed
    dependencies:
      - backend-pagination
      - frontend-state
      - html-pagination
---

# Inbox Pagination

Same three files as before, plus the e2e test file. The existing server-identities pagination pattern (state, rendering, Prev/Next buttons) will be reused for consistency.

## Architecture

The backend already has `limit`; we add `page` (1-based). For the non-search path, `page` shifts the IMAP sequence range window. For the search path, `page` slices the UID array. The response gains a `pagination` object with `page`, `totalPages`, and `total`. The frontend stores this in state and renders Prev/Next buttons.

## 1. Backend: Add `page` param to `/api/v1/mail/messages`

In [gui/local-backend/main.ts](gui/local-backend/main.ts) (~line 1039):

- Parse `page` from query params: `Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1)`.
- **Non-search path**: `total = mailboxExists`. Compute `totalPages = Math.ceil(total / limit)`. Clamp `page` to `totalPages`. The sequence range becomes `end = total - (page - 1) * limit`, `start = Math.max(1, end - limit + 1)`, range = `start:end`. Results are reversed as before.
- **Search path**: `total = uids.length`. Compute `totalPages = Math.ceil(total / limit)`. Clamp page. Slice UIDs for the requested page: `uids.slice(-(page * limit), uids.length - (page - 1) * limit)` (newest-first paging). Fetch those UIDs.
- Both paths return `pagination: { page, totalPages, total }` alongside `messages`.

## 2. Frontend state and rendering

In [gui/app.js](gui/app.js):

- Add `mailPagination: { page: 1, totalPages: 1, total: 0 }` to the `state` object (~line 18).
- After fetching messages (~line 2167), store `state.mailPagination` from `res.pagination` (with fallback).
- Add a `renderMailPagination()` function (modeled on `renderServerIdentitiesPagination` at ~line 1437) that shows/hides the pagination div and updates the info text and button disabled states.
- Call `renderMailPagination()` after `renderMailMessages()`.
- Extract the fetch logic into a helper (e.g. `loadMailMessages(page)`) so both the form submit and the Prev/Next buttons can call it.
- Wire up Prev/Next button click handlers in `initMailPage()`.

## 3. Frontend HTML

In [gui/index.html](gui/index.html) (~line 2227), add a pagination div after the message list, reusing the `pagination-controls` CSS class:

```html
<div id="mail-pagination" class="pagination-controls" style="display: none;">
  <button type="button" class="secondary" id="mail-prev" disabled>← Previous</button>
  <span class="pagination-info" id="mail-page-info">Page 1 of 1</span>
  <button type="button" class="secondary" id="mail-next" disabled>Next →</button>
</div>
```

## 4. E2E test

Add a mock-based test in [gui/e2e/mail.spec.ts](gui/e2e/mail.spec.ts) that:

- Mocks `/api/v1/mail/messages` to return different pages of messages based on the `page` query param, with `pagination` metadata.
- Verifies the page info text updates, Prev is disabled on page 1, Next navigates forward, and Prev navigates back.