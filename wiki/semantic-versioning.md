---
title: "Semantic Versioning in EBP Documentation"
type: concept
status: active
last_updated: 2026-04-23
source_count: 1
tags:
  - concept
  - semver
  - versioning
  - compatibility
---

# Semantic Versioning in EBP Documentation

This page captures how Semantic Versioning (SemVer) should be interpreted when documenting EBP interfaces, payload versions, and release compatibility notes.

## Canonical SemVer Contract

SemVer uses `MAJOR.MINOR.PATCH` where:

- **MAJOR** changes signal backward-incompatible API changes.
- **MINOR** changes signal backward-compatible feature additions (including deprecations).
- **PATCH** changes signal backward-compatible bug fixes.

SemVer assumes a declared public API and immutable releases (published versions are never edited in place). See [[source-semver-2-0-0]].

## Pre-release and Build Metadata

- Pre-release labels (`-alpha`, `-rc.1`) indicate unstable builds and affect precedence.
- Build metadata labels (`+build.42`, `+sha.abc123`) are informational only and do not affect precedence.
- Build metadata should be used for traceability (CI run, commit hash, packaging stamp), not for compatibility signaling.

## Guidance for EBP Wiki Authors

- Treat compatibility claims as SemVer claims only if the relevant public interface is explicitly defined.
- Distinguish protocol/file-format versions from package/release versions:
  - Payload `version` fields (for example in [[message-payload-formats]]) are protocol schema indicators.
  - Project/package tags are release identifiers that may follow SemVer rules.
- When noting a breaking behavior change in a documented public interface, explicitly call out MAJOR impact.

## Related Pages

- [[source-semver-2-0-0]]
- [[message-payload-formats]]
- [[overview]]

## Sources

- [[source-semver-2-0-0]]
- `wiki/raw/semver.md`
