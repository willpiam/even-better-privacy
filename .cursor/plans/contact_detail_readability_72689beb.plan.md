---
name: Contact Detail Readability
overview: Fix Contact Detail so each published detail shows the human-readable value (or opaque hash / resolved cleartext), with an (i) control that reveals the raw proof and full hash via Alert.
todos:
  - id: fix-detail-rows
    content: "Rewrite ContactDetail Details section: show value/hash/resolved + (i) Alert for raw proof/full hash"
    status: completed
isProject: false
---

# Contact Detail Readable Values

## Problem

In [`ContactDetailScreen.tsx`](mobile/src/screens/ContactDetailScreen.tsx), details are rendered as:

```tsx
Object.entries(contact.details).map(([path, [hash, label]]) => (
  ...
  {path}: {label || hash}
```

EBP detail tuples are **`[value, proof]`** (see [`server/db/index.ts`](server/db/index.ts) and GUI [`gui/js/render.js`](gui/js/render.js)), not `[hash, label]`. Preferring the second element shows the long cryptographic **proof** hex — exactly what the screenshot shows for `name:`.

## Approach

Update only [`mobile/src/screens/ContactDetailScreen.tsx`](mobile/src/screens/ContactDetailScreen.tsx) presentation (no service/API changes).

For each `path → [value, proof]`:

| Path kind | Primary display | (i) Alert contents |
|-----------|-----------------|--------------------|
| Cleartext (e.g. `name`, `email`) | `value` | Full value + proof |
| `opaque::*` unresolved | Truncated hash (`12…8` like GUI `formatOpaqueHash`) + muted “hash” | Full hash + proof |
| `opaque::*` resolved | Resolved cleartext from `resolvedOpaqueDetails[path]` + muted “resolved” | Cleartext + full hash + proof |

Layout per row (inside existing `Card`):

- Left: path as small muted label; primary value on the next line
- Right: circular “(i)” `Pressable` (accent color from tokens)
- Tap `(i)` → `Alert.alert(path, rawBody)` with the raw fields listed (simple, no new modal component)

Add a tiny local helper in the screen file (or inline):

- `isOpaquePath(path)` → `path.startsWith('opaque::')`
- `formatOpaqueHash(value)` → truncate when length > 24

Match GUI semantics from [`gui/js/state.js`](gui/js/state.js) / [`gui/js/render.js`](gui/js/render.js) without porting the whole contact modal.

## Out of scope

- Changing how details are stored or synced
- Redesigning the Resolve opaque / Local notes sections
- Wiki updates
