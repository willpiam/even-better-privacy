# Desktop Packaging

`rust-toolchain.toml` pins Rust 1.93.1. The locked Tauri build helper expects
the Cargo output-directory layout used by that release; Cargo 1.100 changes
the layout and fails during Windows resource packaging. Update the framework
and toolchain together, with a compiler/package check. Linux builds require
the WebKitGTK 4.1 development libraries used by Tauri 2.

The Tauri configuration currently treats Linux AppImage as the primary bundled
target. macOS and Windows release artifacts are produced by the external desktop
build scripts rather than by a checked-in Tauri bundle target.

The desktop workspace is served from `gui/`. Its place palettes and local
watercolor atlases match the mobile app. `gui/styles.css` contains shared
workflow components; `gui/workspace.css` defines the desktop shell, themes,
responsive mail reader, and artwork. Appearance is saved locally as
`ebp.ui.appearance` (`light`, `dark`, or `system`). Private keys and mail bodies
continue to use their existing storage and session rules.

The sidecar build embeds both stylesheets, `gui/js/`, and `gui/assets/` along
with the entry page. The native startup screen lives in `desktop/dist/`, with
an external `loader.js` compatible with the Tauri script policy. No remote
fonts or new runtime dependencies are needed for the design.

Run `deno task gui` to review the workspace, `deno task test:e2e` for browser
coverage, and `deno task desktop:backend:build` to rebuild the packaged backend.

Security expectations for all platforms:

- Desktop releases must include the same local backend sidecar build produced by
  `scripts/build_desktop_backend_sidecar.ts`.
- macOS and Windows artifacts must be signed by the platform-native signing
  step before publication.
- If macOS or Windows artifacts are added to the Tauri bundle config, the
  external scripts should be removed or reduced to thin wrappers around the
  Tauri output so there is one release pipeline to audit.
