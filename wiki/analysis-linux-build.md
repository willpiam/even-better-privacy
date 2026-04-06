---
title: "Analysis: Linux Build Process"
type: analysis
status: active
last_updated: 2026-04-06
source_count: 2
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
