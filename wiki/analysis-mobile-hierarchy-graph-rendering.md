---
title: "Mobile Hierarchy Graph Rendering"
type: analysis
status: active
last_updated: 2026-07-29
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

## Status (2026-07-29)

**Implemented** on Certificates → Hierarchy Tree:

- `react-native-svg` + `mobile/src/components/HierarchyTreeView.tsx`
- Enrichment via `mobile/src/services/hierarchyDiagram.ts`
- Leveled layout in `mobile/src/services/hierarchyLayout.ts` (BFS-before-orphans
  so children sit below masters)
- Tap → `HierarchyDiagramDetailModal`; pan + Fit all / ± zoom
- JSON dump removed from `CertificatesScreen.tsx`

Still out of scope: shared `core/` layout extract, pinch-zoom, node drag,
contact-detail entry point, GUI↔mobile E2E.

## Gap (historical)

| Surface | Tree data | Graphical render |
|---------|-----------|------------------|
| GUI | Local/server merge + node enrichment (`nodes`, labels, colors, `isSelf` / `isFocus`) | Interactive SVG (`renderHierarchyTreeSVG` in `gui/js/hierarchy.js`) |
| Mobile (pre-2026-07-29) | Local/server merge (`getMergedHierarchyTree` → `hierarchyTree.ts`) | JSON dump in `CertificatesScreen` |
| Mobile (now) | Same merge + enrichment DTO | SVG diagram on Certificates |

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

## Recommended approach (shipped)

**Port the desktop diagram model into React Native with `react-native-svg`,
reusing the same layout algorithm and visual vocabulary; adapt input to touch.**

### Diagram model

- `nodes[]`: `{ fingerprint, label, color?, isSelf, isFocus }`
- `relationships[]`: existing edge fields (+ `expired`)
- `roots[]`: fingerprints that are not any relationship’s child

Enrich labels with [[analysis-mobile-contact-display-component]] plus current
identity public details (`readCurrentIdentityPublic`).

### Interaction (mobile)

| Desktop | Mobile |
|---------|--------|
| Mouse wheel zoom | **+/−** buttons |
| Drag background pan | One-finger `PanResponder` pan |
| Hover tooltips | Tap → detail modal |
| Drag reposition nodes | Deferred |
| Fit all | Toolbar **fit all** |

Fixed-height ~320pt diagram card; Certificates list scrolls outside the graph.

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
- `mobile/src/screens/CertificatesScreen.tsx`
- `mobile/src/services/hierarchy.ts` / `hierarchyTree.ts` / `hierarchyDiagram.ts` / `hierarchyLayout.ts`
- `mobile/src/components/HierarchyTreeView.tsx`
- [[analysis-hierarchy-gui-e2e-coverage]]
