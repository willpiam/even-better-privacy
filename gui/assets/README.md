# Desktop artwork

`fox-places.webp` and `fox-loops.webp` are the same local watercolor atlases used
by the mobile app. Their provenance and frame map are in
[`mockups/assets/README.md`](../../mockups/assets/README.md). Desktop owns its
copies so the packaged application does not depend on the mockup directory.

`workspace.css` selects the six places using CSS backgrounds and a radial mask.
The four motion rows use six frames each. Loading artwork follows actual work,
stops when the operation finishes, and stays still with reduced motion enabled.

The desktop line icons are local SVG paths in `gui/js/icons.js`. The sidecar
build includes the stylesheets, JavaScript modules, and this asset directory.
No remote fonts, image services, or additional runtime libraries are required.
