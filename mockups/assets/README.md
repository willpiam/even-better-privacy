# The watercolor fox collection

Original AI-generated artwork created for this mock-up, guided by the existing EBP watercolor landscape in `assets/large-logo.png`. The recurring red fox has an ivory muzzle and tail tip, charcoal paws, and hand-painted fur. No remote image services or runtime libraries are used.

Both WebP atlases are 1536 × 1024. Review them in `../assets.html`, which includes motion pause and reduced-motion support. Preserve the atlases' exact dimensions and tile boundaries when replacing them. The browser uses CSS background positions rather than individual cropped files.

## Places — `fox-places.webp`

Six 512 × 512 scenes in three columns and two rows. Use a square `.place-art` element and the matching class from `../artwork.css`. A soft CSS mask fades the paper edges into each screen's palette.

| Row | Column | Class | Setting / use |
| --- | --- | --- | --- |
| 1 | 1 | `place-mail` | Golden meadow, fox collecting an envelope |
| 1 | 2 | `place-identities` | Fern grove, fox guarding a brass key |
| 1 | 3 | `place-contacts` | Rose garden, two foxes and stepping stones |
| 2 | 1 | `place-tools` | Teal woodland, fox inspecting a wax seal |
| 2 | 2 | `place-settings` | Lavender twilight, fox resting at its den |
| 2 | 3 | `place-compose` | Blue flower path, fox carrying a letter |

## Loops — `fox-loops.webp`

An alpha-transparent atlas with six 256 × 256 frames per row and four rows. Frames run left to right. Each motion returns to its initial pose; slight watercolor variations are part of the painted animation. The frames use a fixed camera and canvas, and the CSS loops with `steps(6, end)` from horizontal position 0% to 120%. The endpoint wraps immediately; visible frame positions are 0%, 20%, 40%, 60%, 80%, 100%.

| Row | Class | Duration | Use |
| --- | --- | --- | --- |
| 1 | `fox-sniff` | 1.8s | Investigating a signature / seal |
| 2 | `fox-watch` | 2.4s | Watching a key during crypto previews |
| 3 | `fox-carry` | 0.9s | Walking with a letter during send previews |
| 4 | `fox-rest` | 3s | Breathing / resting; static in empty mail views |

Combine `.fox-loop`, a motion class, and `.is-playing`. Omit `.is-playing` for a still. Set the same CSS width and height to scale a frame. Mark decorative instances `aria-hidden="true"`; put actual progress information in adjacent live status text. `prefers-reduced-motion: reduce` shows the first frame. The gallery supports pausing all loops; tool cards play only on hover or keyboard focus. Workflow loops stop when the preview completes or the dialog closes.

The 2.4-second busy states are deliberately simulated for visual review. No mail is sent and no keys, encryption, or verification are performed. Repeated submission is disabled while busy; closing a dialog cancels its pending result.
