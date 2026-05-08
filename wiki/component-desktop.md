---
title: "EBP Desktop Component"
type: component
status: active
last_updated: 2026-05-06
source_count: 11
tags:
  - component
  - desktop
  - tauri
---

# Desktop Component

EBP's desktop package wraps the [[component-gui|GUI]] in a Tauri shell under `desktop/`. The desktop app exists to distribute the GUI as native packages such as the Linux AppImage while reusing the same local backend and frontend.

## Current Architecture

- **Tauri shell** (`desktop/src-tauri/`): a Rust binary that creates the webview and spawns the packaged `ebp-gui-backend` sidecar during app setup, then terminates that child process when the window closes.
- **Sidecar backend** (`ebp-gui-backend`): a Deno-compiled build of `gui/local-backend/main.ts` (compiled via `scripts/build_desktop_backend_sidecar.ts`) that serves the frontend and local REST API on `http://127.0.0.1:8787`.
- **Loader redirect** (`desktop/dist/index.html`): polls the sidecar health endpoint, then redirects the webview to the sidecar-served GUI. This avoids stale frontend assets in rebuilt AppImages.

## Packaging Surface

Desktop packaging is orchestrated through platform-specific scripts at the repository root:

- `build_desktop_linux.sh` builds an AppImage and writes `EBP.AppImage` to the repo root.
- `build_desktop_mac.sh` builds a DMG and writes `EBP.dmg` (and optionally `EBP.app`) to the repo root.
- `build_desktop_windows.sh` builds an MSI and writes `EBP.msi` to the repo root, creating `desktop/dist/index.html` if it is missing in a fresh clone.

## Security and Build Notes

The April 2026 security audit tracked Tauri-specific findings around shell-open scope, webview CSP, sidecar resolution, bundle targets, and sidecar log permissions. Those findings are recorded in [[security-audit-2026-04/findings]] and the Tauri/desktop phase notes.

The Linux build flow is documented in [[analysis-linux-build]], including required system packages, the AppImage output path, and the sidecar redirect rationale.

## Related Pages

- [[component-gui]]
- [[analysis-linux-build]]
- [[analysis-application-complexity-debt]]
- [[security-audit-2026-04/phase-05-cli-website-tauri]]
- [[security-audit-2026-04/phase-06-supply-chain]]
- [[security-audit-2026-04/findings]]
- [[overview]]

## Sources

- `desktop/src-tauri/`
- `desktop/src-tauri/src/main.rs`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/package.json`
- `desktop/dist/index.html`
- `scripts/build_desktop_backend_sidecar.ts`
- `build_desktop_linux.sh`
- `build_desktop_mac.sh`
- `build_desktop_windows.sh`
- [[analysis-linux-build]]
- [[security-audit-2026-04/phase-05-cli-website-tauri]]
