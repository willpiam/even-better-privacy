# Watercolor places

These local WebP atlases are copied from `mockups/assets` so the mobile bundle
owns its artwork and does not depend on a prototype directory at runtime.
The original asset provenance and tile map are in `mockups/assets/README.md`.

`FoxArt` selects one of six 512 × 512 places from `fox-places.webp` and uses a
native SVG radial mask to soften its paper edges. `FoxMotion` selects six
256 × 256 frames from a row in `fox-loops.webp`. It pauses for the system's
reduced-motion preference and clears its timer when unmounted. Progress artwork
only runs while actual work is underway; it never delays a result.

The additional line illustrations are defined as scalable SVG paths in
`components/AppIcon.tsx`. All artwork ships locally, with no new dependencies,
fonts, analytics, or image service calls.
