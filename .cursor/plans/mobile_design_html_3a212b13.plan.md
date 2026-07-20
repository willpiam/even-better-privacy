---
name: Mobile Design HTML
overview: Create a single self-contained Figma-style HTML canvas at the project root that depicts a planned unified mobile UI (bottom-tab navigation + consistent busy states) as static phone frames you can pan/zoom to review.
todos:
  - id: scaffold-html
    content: Create ebp_mobile_design.html with canvas shell, grid, pan/zoom controls
    status: completed
  - id: design-tokens
    content: Define CSS variables and shared phone/tab/busy/button/field styles
    status: completed
  - id: screen-frames
    content: Lay out ~18–22 labeled phone frames covering tabs, flows, and busy states
    status: completed
  - id: verify-viewer
    content: Sanity-check pan/zoom and visual hierarchy in browser if feasible
    status: completed
isProject: false
---

# EBP Mobile Design Canvas

## Deliverable

One file: [`ebp_mobile_design.html`](ebp_mobile_design.html) at the repo root.

- Self-contained (inline CSS/JS, no build, no external deps)
- Open in a browser; pan/zoom a large plane of labeled phone mockups
- View-only — no edit tools, no property panels, no drag-to-rearrange screens
- This is a **design proposal** for review, not an implementation of the RN app

## Interaction model (Figma-like viewer)

- Infinite-ish canvas with a dotted grid background
- **Pan:** middle-mouse drag, or space+left-drag, or trackpad/mouse drag on empty canvas
- **Zoom:** Ctrl/Cmd + scroll wheel (centered on cursor); optional `+`/`-`/`100%`/`Fit` controls in a thin top chrome bar
- Each screen is a fixed phone frame (~390×844) with a label above it (title + short note)
- Screens laid out in clusters by flow so related states sit near each other
- Minimal chrome: title “EBP Mobile UI Plan”, zoom readout, hint text (“drag to pan · ctrl+scroll to zoom”)
- No selection handles, no layers panel, no export — review only

## Planned IA (chosen default)

**Bottom tabs** as the unified navigation chrome (replacing the current Home button farm):

| Tab | Primary surfaces |
|-----|------------------|
| Identities | list, create, HD create, identity detail |
| Contacts | list, detail, key-server browse |
| Crypto | Sign/Verify, Encrypt/Decrypt (segmented or stacked entry) |
| Mail | accounts, setup, inbox, message, compose |
| More | Settings, Certificates, Project Info (Mail Trace demoted here or omitted from product UI) |

Shared chrome on every product screen: status bar strip, nav/header, content, bottom tab bar (active tab highlighted).

## Design system depicted in the mockups

Unify what the code currently scatters:

- Accent `#1a5fb4` (from existing [`BusyOverlay`](mobile/src/components/BusyOverlay.tsx))
- Neutrals: white surfaces, `#111` text, `#e8e8e8` borders
- Danger `#d11a2a`
- Typography: system UI stack sized for mobile readability
- Components shown consistently: primary/secondary buttons, text fields, list rows, banners, tab bar, **BusyOverlay** (dimmed modal + spinner + message)

## Screen frames to include (~18–22 frames)

Grouped on the canvas roughly left-to-right by flow:

1. **Shell / nav** — Identities tab home (identity list + current identity chip); empty state
2. **Identities** — Create Identity; HD Create (mnemonic step); Identity Detail; **busy: Publishing…** overlay
3. **Contacts** — list + import actions; Contact Detail; **busy: Syncing…**
4. **Crypto** — Sign/Verify; Encrypt/Decrypt with contact picker; **busy: Encrypting…** / **Verifying…**
5. **Mail** — Accounts; Account Setup; Inbox (loading spinner in list); Message; Compose (+ recipient resolve sheet)
6. **More** — Settings; Certificates; Project Info
7. **Patterns strip** — dedicated frames for: full-screen BusyOverlay, inline list spinner, button disabled+spinner, success/error StatusBanner

Each frame is static HTML/CSS (phone bezel + content), not interactive app logic. Busy states are shown as separate labeled frames so you can compare resting vs waiting UI.

## What will *not* be in the file

- Live React Native wiring or real data
- Editable Figma tools (move/resize screens, inspect, comments)
- Dark mode variants (unless you ask later)
- Pixel-perfect iOS vs Android — one generic phone shell

## Implementation notes

- Pure HTML + CSS + a small JS pan/zoom controller (`transform: translate + scale` on a canvas root)
- Phone frames as absolutely positioned sections inside the canvas
- Readable labels under each frame describing the intent (“unified busy overlay”, “tab: Mail”, etc.)
- File is standalone documentation for design review; no wiki ingest unless you ask later

## After your review

Once you give feedback on the HTML, we can iterate the mockup file, then (in a later task) map approved patterns onto the RN app (`AppNavigator`, shared components, BusyOverlay usage).
