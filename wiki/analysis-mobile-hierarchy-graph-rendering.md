---
title: "Mobile Hierarchy Graph Rendering"
type: analysis
status: active
last_updated: 2026-07-28
source_count: 6
tags:
  - analysis
  - mobile
  - hierarchy
  - gui
  - ux
  - svg
---

# Mobile Hierarchy Graph Rendering

Recommended approach for rendering identity hierarchy **graphically** on
[[component-mobile]], matching the desktop SVG tree on [[component-gui]] while
adapting interaction and chrome for React Native.

## Gap

| Surface | Tree data | Graphical render |
|---------|-----------|------------------|
| GUI | Local/server merge + node enrichment (`nodes`, labels, colors, `isSelf` / `isFocus`) | Interactive SVG (`renderHierarchyTreeSVG` in `gui/js/hierarchy.js`) |
| Mobile | Local/server merge (`getMergedHierarchyTree` → `hierarchyTree.ts`) | **JSON dump** in `CertificatesScreen` (`JSON.stringify` into a `TextField`) |

Parity v1 closed hierarchy **propose / accept / merged tree data**
([[analysis-gui-mobile-parity-deltas]], [[analysis-mobile-parity-roadmap]]), not
visual parity with the desktop diagram
([[analysis-mobile-certificates-ux]] covers propose UX only).

## What desktop already does (keep as reference)

`gui/js/hierarchy.js`:

1. **Layout** — `_layoutTree`: BFS levels from roots, fixed row spacing, centered
   nodes per level.
2. **Edges** — cubic Bezier master→child with arrow markers; expired edges use
   warning color.
3. **Nodes** — circle + truncated label + short fingerprint; self/focus CSS
   classes.
4. **Interaction** — pan (drag background), zoom (wheel), drag nodes, hover
   tooltips, **fit all** viewBox reset.
5. **Enrichment** — GUI local-backend builds `nodes[]` from contacts / self
   details before the frontend renders (`gui/local-backend/routes.ts`
   hierarchy tree responses).

E2E asserts `#contact-detail-hierarchy svg` and `.ht-node-group` count
([[analysis-hierarchy-gui-e2e-coverage]]).

## Recommended approach

**Port the desktop diagram model into React Native with `react-native-svg`,
reusing the same layout algorithm and visual vocabulary; adapt input to touch.**

Do **not** embed a WebView of the GUI SVG, and do **not** introduce a heavy
graph library (D3, Skia force layouts) for this tree size.

### 1. Shared / mirrored diagram model

Keep crypto/merge in existing mobile services. Add a thin **diagram DTO** shaped
like the GUI renderer input:

- `nodes[]`: `{ fingerprint, label, color?, isSelf, isFocus }`
- `relationships[]`: existing edge fields (+ `expired`)
- `roots[]`: typically `[tree.root]` from `buildHierarchyTreeFromCertificates`

Enrich labels on mobile with [[analysis-mobile-contact-display-component]]
(`contactDisplay`) plus current-identity details — same role as the GUI backend
enrichment loop, without inventing a second tree builder.

Optional later: extract `_layoutTree` (+ pure edge-path helper) into a shared
`core/` or `shared/` module used by GUI and mobile so spacing/edge math cannot
drift. Not required for a first mobile-only port if layout constants are copied
faithfully.

### 2. Render with `react-native-svg`

Mobile currently has **no** SVG dependency (`mobile/package.json`). Add
`react-native-svg` and implement a `HierarchyTreeView` component:

- `Svg` + `G` / `Circle` / `Path` / `Text` / `Defs` / `Marker`
- Same level layout and Bezier edges as `_layoutTree` / `edgePathD`
- Expired edge styling preserved
- Replace Certificates **Tree output** `TextField` with this view

Avoid `SvgXml` of a prebuilt DOM string if interactivity (tap, pan, fit) is
required — declarative RN SVG elements are clearer.

### 3. Mobile interaction adaptations

| Desktop | Mobile adaptation |
|---------|-------------------|
| Mouse wheel zoom | Pinch zoom (gesture handler) and/or ± buttons |
| Drag background pan | One-finger pan on the SVG surface |
| Hover tooltips | Tap node / edge → bottom sheet or modal (details, context, expiry) |
| Drag reposition nodes | Defer or long-press; optional for v1 (layout-only is enough) |
| Fit all button | Keep; place in card header / toolbar for thumb reach |
| Large hover hit paths | Larger tap targets (≥44pt) on edges/nodes |

Prefer a fixed-height diagram card (e.g. ~280–360pt) with pan/zoom inside, so
the rest of Certificates (propose / pending / active lists) remains scrollable
outside the graph — avoid fighting nested scroll vs pan.

### 4. Where it lives in the app

Primary: replace the Hierarchy Tree section on `CertificatesScreen.tsx` (same
`ContactPicker` + Load Tree flow; swap JSON for `HierarchyTreeView`).

Secondary (later): contact-detail “View Hierarchy” equivalent if/when mobile
gains a contact detail surface matching GUI’s
`#contact-detail-hierarchy` entry point.

### 5. What not to do

- **WebView of `gui/js/hierarchy.js`** — packaging, auth/storage, and touch
  mapping cost more than a focused RN port.
- **Outline-only nested lists as the final UX** — useful as a fallback for
  accessibility / empty states, not a substitute for graphical parity.
- **Force-directed / animated physics layouts** — desktop is a static leveled
  tree; match that.

## Implementation sketch

1. Add `react-native-svg` (+ gesture deps if not already available via navigation).
2. `enrichHierarchyDiagram(tree, { selfFp, contacts })` → GUI-compatible DTO.
3. Port `_layoutTree` + edge path math into `mobile/src/components/HierarchyTreeView.tsx` (or shared module).
4. Wire Load Tree → set diagram state → render view; keep error/empty copy.
5. Tap → detail sheet; Fit all; pinch/pan.
6. Unit-test layout positions for a 2-node master→child fixture (align with
   `test/mobile-parity_test.ts` tree merge coverage). Manual visual check vs GUI
   for the same certs. Cross-client E2E remains absent
   ([[analysis-hierarchy-gui-e2e-coverage]]).

## Uncertainty

- Exact gesture library choice depends on what RN 0.84 + current navigation
  already pull transitively; wiki does not pin a gesture stack beyond navigation
  packages.
- Whether to extract shared layout into `core/` vs copy-once is a maintainability
  tradeoff, not a product blocker.

## Related

- [[component-mobile]]
- [[component-gui]]
- [[analysis-gui-mobile-parity-deltas]]
- [[analysis-mobile-parity-roadmap]]
- [[analysis-mobile-certificates-ux]]
- [[analysis-hierarchy-gui-e2e-coverage]]
- [[analysis-mobile-contact-display-component]]

## Sources

- `gui/js/hierarchy.js` (`_layoutTree`, `renderHierarchyTreeSVG`)
- `gui/local-backend/routes.ts` (hierarchy tree `nodes` enrichment)
- `mobile/src/screens/CertificatesScreen.tsx` (JSON tree output)
- `mobile/src/services/hierarchy.ts` / `hierarchyTree.ts`
- `mobile/package.json` (no SVG dependency as of this analysis)
- [[analysis-hierarchy-gui-e2e-coverage]]
