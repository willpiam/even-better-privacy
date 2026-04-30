---
title: "Release Process"
type: concept
status: active
last_updated: 2026-04-30
source_count: 0
tags:
  - release
  - supply-chain
  - reproducible-builds
---

# Release Process

This page records the release controls added for [[security-audit-2026-04]].

## Reproducibility checklist

- Build from a signed git tag and record the exact commit SHA.
- Use `deno.lock`, `package-lock.json`, and `desktop/package-lock.json`; desktop
  builds must use `npm ci`.
- Build the server image from the digest-pinned `denoland/deno` base in
  `Dockerfile`.
- Run `deno task lint:docker-base`, `deno task lint:build-scripts`,
  `deno task lint:playwright-dev`, and `deno task lint:release-artifacts`.
- Generate artifact checksums with:

```sh
deno task release:manifest <artifact>...
```

## Verification

Two maintainers should rebuild the same signed tag on clean machines and compare
the generated checksum manifest before publishing GitHub release assets.

## Sources

- `Dockerfile`
- `build_desktop_linux.sh`
- `build_desktop_mac.sh`
- `build_desktop_windows.sh`
- `scripts/release_manifest.ts`
