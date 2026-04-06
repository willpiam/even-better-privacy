---
title: "Analysis: Linux Build Process"
type: analysis
status: active
last_updated: 2026-04-06
source_count: 4
tags:
  - build
  - linux
  - desktop
  - tauri
---

# Linux Build Process

## Summary

EBP supports Linux in two distinct ways:

- Install the prebuilt desktop app by downloading the latest `.AppImage` from GitHub Releases.
- Build your own Linux desktop package locally by running `build_desktop_linux.sh` from the repository root.

## Local Build Steps

The documented local build prerequisites are:

- Node + NPM
- Rust + Cargo
- Deno

The Linux build script also calls out required system packages:

- `libwebkit2gtk-4.0-dev`
- `libssl-dev`
- `build-essential`

Typical local build flow:

```bash
sudo apt install libwebkit2gtk-4.0-dev libssl-dev build-essential
./build_desktop_linux.sh
```

The script changes into `desktop/`, runs `npm install`, executes `npm run build` (`tauri build`), then manually rebuilds the AppImage because the normal Tauri AppImage bundling step is noted as unreliable in this project.

## Output

If the build completes successfully, the expected output is:

- `EBP.AppImage` at the repository root

## Desktop Architecture: Sidecar Redirect

The desktop app has two binaries inside the AppImage:

1. **Tauri shell** (`ebp`) — a Rust binary that creates a WebKit webview and spawns the sidecar. It embeds static assets from `distDir` at Cargo compile time via `tauri::generate_context!()`.
2. **Sidecar** (`ebp-gui-backend`) — a Deno-compiled binary of `gui/local-backend/main.ts`. It serves both the full frontend (HTML/JS) and all API endpoints on `http://127.0.0.1:8787`.

### Previous Problem: Stale Frontend in Tauri Binary

Tauri v1's `distDir` was originally set to `../../gui`, causing the full `gui/index.html` and `gui/app.js` to be embedded in the Rust binary. Cargo's incremental compilation often failed to detect changes to these files, so rebuilt AppImages would ship old frontend code even though the sidecar was freshly compiled.

### Fix: Loader Redirect

`distDir` was changed to `../dist`, which contains only a lightweight loader page (`desktop/dist/index.html`). This loader polls the sidecar's health endpoint and, once the sidecar is ready, redirects the webview to `http://127.0.0.1:8787/`. The sidecar (always freshly compiled by `deno compile`) then serves the real `index.html` and `app.js`.

This means:
- The Tauri binary only embeds the tiny loader — its contents never need to change.
- All frontend and backend code lives in the sidecar, which is always recompiled.
- Cargo caching of the Tauri binary is harmless.

## Notes

- The script optionally loads extra build-time environment variables from `.env.desktop.build` if that file exists.
- The script only supports `x86_64` and `aarch64` / `arm64` Linux architectures.
- The README separately documents a source-run workflow for development via `deno task gui`, which is different from producing a distributable AppImage.

## Related Pages

- [[component-gui]]
- [[overview]]

## Sources

- `ReadMe.md`
- `build_desktop_linux.sh`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/dist/index.html`