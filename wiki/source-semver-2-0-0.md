---
title: "Semantic Versioning 2.0.0"
type: source-summary
status: active
last_updated: 2026-04-23
source_count: 1
tags:
  - source
  - semver
  - versioning
  - release-engineering
---

# Semantic Versioning 2.0.0

Semantic Versioning 2.0.0 defines a compatibility contract for published software: version numbers communicate API impact using `MAJOR.MINOR.PATCH`.

## Core Rules

- Declare a clear public API before version numbers are meaningful.
- Use `X.Y.Z` where each part is a non-negative integer with no leading zeros.
- Never modify contents of an already released version; ship a new version instead.
- Use `0.y.z` for unstable initial development and treat `1.0.0` as the first stable public API contract.

## Bump Semantics

- **PATCH** (`x.y.Z`): backward-compatible bug fixes only.
- **MINOR** (`x.Y.z`): backward-compatible functionality additions, including deprecations.
- **MAJOR** (`X.y.z`): any backward-incompatible public API change.

When minor is incremented, patch resets to `0`; when major is incremented, both minor and patch reset to `0`.

## Pre-release and Build Metadata

- **Pre-release** labels are appended with `-` (example: `1.4.0-rc.1`) and lower precedence than the associated normal release.
- **Build metadata** is appended with `+` (example: `1.4.0+build.20260423`) and does not affect version precedence.
- Metadata identifiers are dot-separated ASCII alphanumerics or hyphen (`[0-9A-Za-z-]`) and cannot be empty.

## Version Precedence Highlights

- Comparison order is major, then minor, then patch, then pre-release identifiers.
- Numeric pre-release identifiers compare numerically.
- Non-numeric pre-release identifiers compare lexically in ASCII order.
- Numeric pre-release identifiers have lower precedence than non-numeric identifiers.

## Relationship to EBP Wiki

This source defines release/versioning semantics used when documenting compatibility expectations for EBP interfaces and payload formats.

## Related Pages

- [[semantic-versioning]]
- [[overview]]
- [[message-payload-formats]]

## Sources

- `wiki/raw/semver.md`
