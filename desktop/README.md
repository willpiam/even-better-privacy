# Desktop Packaging

The Tauri configuration currently treats Linux AppImage as the primary bundled
target. macOS and Windows release artifacts are produced by the external desktop
build scripts rather than by a checked-in Tauri bundle target.

Security expectations for all platforms:

- Desktop releases must include the same local backend sidecar build produced by
  `scripts/build_desktop_backend_sidecar.ts`.
- macOS and Windows artifacts must be signed by the platform-native signing
  step before publication.
- If macOS or Windows artifacts are added to the Tauri bundle config, the
  external scripts should be removed or reduced to thin wrappers around the
  Tauri output so there is one release pipeline to audit.
