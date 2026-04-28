---
name: toast-copy-and-logs
overview: Add interactive toast copy behavior and a session-only toast history panel in Settings with a capped in-memory log.
todos:
  - id: state-toast-logs
    content: Add session toast log state with 50-entry cap
    status: completed
  - id: toast-copy
    content: Make toast clickable and implement clipboard copy behavior
    status: completed
  - id: settings-logs-ui
    content: Add Settings Logs section markup and styles
    status: completed
  - id: logs-rendering
    content: Implement log rendering and clear action wiring
    status: completed
  - id: verify-behavior
    content: Validate cap, session-only lifecycle, and existing toast behavior
    status: completed
isProject: false
---

# Toast Copy + Settings Logs Plan

## Scope
Implement two UX improvements in the GUI:
- Make the bottom toast clickable to copy its current message.
- Add a `Logs` section in Settings showing recent toast messages (session-only, capped at 50 entries).

## Files to Update
- [gui/js/ui.js](/home/william/projects/even-better-privacy/gui/js/ui.js)
- [gui/js/state.js](/home/william/projects/even-better-privacy/gui/js/state.js)
- [gui/js/render.js](/home/william/projects/even-better-privacy/gui/js/render.js)
- [gui/app.js](/home/william/projects/even-better-privacy/gui/app.js)
- [gui/index.html](/home/william/projects/even-better-privacy/gui/index.html)

## Implementation Steps
1. Extend toast state model
- Add a session-only `toastLogs` array to app state in `state.js`.
- Add constants for cap (`50`) and optionally kind labels.

2. Upgrade `setStatus` in `ui.js`
- On each status update, append a log record `{ message, kind, timestamp }`.
- Keep newest-first or oldest-first consistently and trim to 50 entries.
- Keep current auto-dismiss logic unchanged.

3. Add clickable toast copy UX
- Make `#status` interactive in CSS (`pointer-events` enabled, cursor affordance).
- Add click handler that copies `statusEl.textContent` via `navigator.clipboard.writeText(...)`.
- Show lightweight feedback (e.g., temporary text or a brief success toast message that avoids recursion).

4. Add Settings `Logs` section UI
- In Settings page markup, add a new section titled `Logs`.
- Include:
  - scrollable list container for entries,
  - empty state text,
  - optional `Clear Logs` button (recommended for usability).

5. Render + wire logs list
- Implement `renderToastLogs()` in `render.js` to map `state.toastLogs` into the new list.
- Call it from `loadAll()` to initialize the section.
- Re-render logs whenever `setStatus` is called (via direct callback or import-safe hook pattern).
- Wire `Clear Logs` to empty session logs and re-render.

6. Validation
- Manual checks:
  - Clicking a visible toast copies exact text.
  - New statuses appear in Settings > Logs immediately.
  - List is capped to 50 entries.
  - Reload clears logs (session-only behavior).
  - Existing toast colors/timing (success/info/error) still behave as before.
- Run/inspect lints for touched files and resolve any introduced issues.