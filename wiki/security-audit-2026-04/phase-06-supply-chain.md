---
title: "Phase 6 — Supply chain & build pipeline"
type: analysis
status: active
last_updated: 2026-04-18
source_count: 0
tags:
  - security-audit
  - phase-6
  - supply-chain
  - dependencies
  - build
---

# Phase 6 — Supply chain & build pipeline

Part of the April 2026 [[README|EBP Security Audit]]. Covers `deno.json` / `deno.lock`, `package.json` / `package-lock.json`, `desktop/src-tauri/Cargo.toml` / `Cargo.lock`, the `Dockerfile`, and the four `build_*.sh` scripts plus `scripts/build_desktop_backend_sidecar.ts`.

## Snapshot

- **Deno deps** (`jsr:` and `https://deno.land/x/`): all entries in `deno.lock` carry SHA-256 integrity hashes (verified). Pinning is OK, but `https://deno.land/std@0.224.0` is from early 2024 — significantly out of date.
- **npm deps** (`package.json`): `imapflow ^1.2.12`, `mailparser ^3.9.3`, `@playwright/test ^1.58.2`. `npm audit` reports 3 vulnerabilities (1 moderate, 2 low) — see F-DEP-01.
- **Rust deps** (`desktop/src-tauri/Cargo.toml`): Tauri **1.6** (latest is 2.x). `cargo audit` reports 2 RUSTSEC vulnerabilities + 15 unmaintained-crate warnings — see F-DEP-02.
- **Dockerfile**: pinned to `denoland/deno:2.6.6` by tag (not by digest), no `USER` directive (already raised as F-SERVER-05), no HEALTHCHECK.
- **Build scripts**: all use `set -euo pipefail`. Linux build downloads `appimagetool` from GitHub releases over HTTPS without checksum verification — see F-BUILD-01.
- **Secrets**: nothing committed. Search for AWS keys, JWTs, PEM private keys, `client_secret` returned no hits outside `wiki/raw/` and `node_modules/`. Mail OAuth `MAIL_OAUTH_*_CLIENT_ID` env vars are read at build time only.

## Findings

### F-DEP-01 — Vulnerable `nodemailer` dependency chain (Medium)

**Tooling:** `npm audit` (full output: `tooling-output/phase-06-npm-audit.txt`).

```
nodemailer  <=8.0.4
Severity: moderate
- Nodemailer has SMTP command injection due to unsanitized `envelope.size` parameter (GHSA-c7w3-x93f-qmm8)
- Nodemailer Vulnerable to SMTP Command Injection via CRLF in Transport name Option (EHLO/HELO) (GHSA-vvjj-xcjg-gr5g)

mailparser 2.3.1 - 3.9.5 — depends on vulnerable nodemailer
imapflow 1.0.77 - 1.2.16 — depends on vulnerable nodemailer
```

EBP itself uses `nodemailer ^6.10.1` (top-level), `mailparser ^3.9.3`, and `imapflow ^1.2.12`. Both transitively pull in vulnerable `nodemailer` versions. The two CVEs are SMTP command injection — relevant when EBP's GUI local backend uses `nodemailer` to send mail through user-configured SMTP transports. An attacker who controls the `envelope.size` numeric coercion or the SMTP transport `name` could inject CRLF into EHLO commands.

**Exploitability for EBP:** The SMTP `envelope.size` is set internally from message size; the `name` transport option is fixed in EBP code. So direct exploitation by remote payloads is unlikely *today*, but defense-in-depth says fix the dep.

**Resolves:** F-GUI-05's conditional severity drops from "High (cond.)" to confirmed "Medium" via this finding.

**Recommendation:** `npm audit fix` (the report says fix is available). Pin to `nodemailer ^8.0.4` or higher; bump `mailparser` to a version that no longer depends on the vulnerable `nodemailer` range.

### F-DEP-02 — Tauri 1.x is in maintenance mode and ships vulnerable / unmaintained crates (High)

**Tooling:** `cargo audit` (full output: `tooling-output/phase-06-cargo-audit.txt`).

Cargo.toml uses `tauri = "1.6"`. Tauri 2.x is the current major version and Tauri 1.x is in maintenance — many of its transitive dependencies (gtk-rs 0.15, atk 0.15, gdk 0.15, kuchikiki, fxhash, html5ever 0.26) are unmaintained and will not get further security fixes.

`cargo audit` reports active vulnerabilities:

| Crate | Version | RUSTSEC | Severity | Issue |
|---|---|---|---|---|
| `tar` | 0.4.44 | RUSTSEC-2026-0068 | Medium | tar-rs incorrectly ignores PAX size headers if header size is nonzero |
| `tar` | 0.4.44 | RUSTSEC-2026-0067 | Medium | `unpack_in` can chmod arbitrary directories by following symlinks |
| `rand` | 0.7.3 | RUSTSEC-2026-0097 | Unsound | Rand is unsound with a custom logger using `rand::rng()` |
| `rand` | 0.8.5 | RUSTSEC-2026-0097 | Unsound | (same advisory) |

`tar` is pulled by `tauri 1.8.3` directly. The `unpack_in` advisory is exploitable when extracting tarballs — Tauri uses `tar` for asset/update bundling. If EBP ever enables Tauri's auto-updater (it does not today), or extracts user-supplied tarballs, this becomes directly exploitable.

Unmaintained warnings (15 total) cover the entire GTK3 binding stack (`gtk`, `atk`, `gdk`, `gdk-sys`, `gdkx11-sys`, etc.), `cssparser` 0.27, `kuchikiki`, `fxhash`, `phf` 0.8, `html5ever` 0.26, `string_cache` 0.8, `markup5ever` 0.11. These will not receive future security fixes — any new vuln stays unpatched until the broader Tauri 1.x → 2.x migration.

**Recommendation:** prioritise migration to **Tauri 2.x**. This is the single largest supply-chain win. Tauri 2.x's permission/scope/capabilities model also addresses F-TAURI-01 and F-TAURI-02 directly.

### F-DEP-03 — `deno.land/std@0.224.0` is significantly outdated (Low)

**Files:** [`deno.json:20-22`](../../deno.json).

```json
"std/dotenv": "https://deno.land/std@0.224.0/dotenv/mod.ts",
"std/http/server": "https://deno.land/std@0.224.0/http/server.ts",
"std/http/status": "https://deno.land/std@0.224.0/http/status.ts"
```

`std@0.224.0` was released in early 2024. The current canonical Deno standard library lives on JSR (`jsr:@std/...`). While `std@0.224.0` does have integrity hashes in `deno.lock` (verified), it is no longer receiving security fixes. The HTTP server module in particular has had multiple iterations since.

**Recommendation:** migrate to `jsr:@std/http`, `jsr:@std/dotenv` at the latest pinned versions. Drop `https://deno.land/x/...` URL imports in favour of JSR equivalents where they exist.

### F-DEP-04 — `deno.land/x/sqlite@v3.9.1` and `deno.land/x/postgres@v0.17.0` (Low / Informational)

URL imports from `deno.land/x` are integrity-pinned in `deno.lock` (good). However, `deno.land/x` is unmaintained going forward — Deno is migrating everything to JSR. `postgres@v0.17.0` and `sqlite@v3.9.1` are both several versions behind. Audit the changelogs for security fixes since these versions and migrate when possible.

### F-DEP-05 — `nodeModulesDir: auto` and Playwright as a runtime dep (Informational)

`deno.json` enables `nodeModulesDir: auto`, materialising `node_modules/` on disk. `@playwright/test` is a `devDependency` but still installed by default during `npm install` runs. Playwright bundles Chromium binaries (~150MB) — which is fine for a dev dep but a developer-machine attack surface (Chromium CVEs) and a build-host disk-space concern.

### F-BUILD-01 — `appimagetool` downloaded over HTTPS without checksum (Medium)

**File:** [`build_desktop_linux.sh:101-106`](../../build_desktop_linux.sh).

```bash
APPIMAGETOOL="${HOME}/.cache/tauri/appimagetool-x86_64.AppImage"
if [ ! -f "${APPIMAGETOOL}" ]; then
  echo "Downloading appimagetool…"
  wget -q -4 "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage" \
    -O "${APPIMAGETOOL}"
fi
chmod +x "${APPIMAGETOOL}"
```

The `continuous` tag on AppImage/AppImageKit is a *moving* tag — the artifact at that URL changes over time, and a compromise of the AppImage GitHub releases (or an MITM in the absence of a checksum) would result in arbitrary code execution at build time. No SHA-256 verification is performed.

**Recommendation:** pin to a specific release tag (not `continuous`) and verify via SHA-256 stored in-repo:
```bash
EXPECTED_SHA=...  # from upstream release
echo "$EXPECTED_SHA  $APPIMAGETOOL" | sha256sum --check
```

### F-BUILD-02 — Linux build script intentionally bypasses Tauri patchelf step (Informational)

**File:** [`build_desktop_linux.sh:93-111`](../../build_desktop_linux.sh).

The script copies the *original* Deno-compiled sidecar back over the patched one and repackages with `appimagetool`. This is a legitimate workaround for a Tauri+linuxdeploy bug (patchelf corrupts Deno's standalone-binary section), but it means the AppImage shipping path is hand-stitched and bypasses the normal verified Tauri bundle pipeline.

A reviewer auditing the released AppImage will not get the same result as Tauri's standard `bundle/appimage` output. Document this clearly in release notes.

### F-BUILD-03 — `npm install` invoked at build time (Informational)

All three desktop build scripts invoke `npm install` (without `npm ci`). `npm install` may resolve newer transitive versions than what is locked in `package-lock.json`. Use `npm ci` for reproducible builds.

### F-BUILD-04 — Mail OAuth client IDs are baked into the Tauri binary at compile time (Low)

**Files:** [`desktop/src-tauri/src/main.rs:8-9, 29-38`](../../desktop/src-tauri/src/main.rs); env-var loading in `build_desktop_*.sh` from `.env.desktop.build`.

OAuth client IDs (Gmail, Outlook) are loaded via `option_env!()` at compile time and burned into the binary. They're then passed to the sidecar via `cmd.env(...)`. OAuth client IDs are not strictly secret (they are shipped in any OAuth-using desktop app), but:
- Any release of EBP will identify itself with the project's Gmail/Outlook OAuth client. Provider-side abuse, app-quota exhaustion, or revocation by Google/Microsoft impacts all installed copies simultaneously.
- The *redirect URI* configured at the OAuth provider must be precisely `http://127.0.0.1:8787/api/v1/mail/oauth/callback`. If the local backend port changes, OAuth is broken across all installed binaries.

Recommendation: document the redirect URI dependency explicitly; rotate client IDs on any compromise.

### F-DOCKER-01 — Image is pinned by tag, not digest (Low)

**File:** [`Dockerfile:1`](../../Dockerfile).

```dockerfile
FROM denoland/deno:2.6.6
```

`denoland/deno:2.6.6` is a tag, not a digest. A registry compromise or a tag mutation (Docker tags are mutable) could swap the base image. Pin to `denoland/deno@sha256:<digest>`.

Also: no HEALTHCHECK, no `USER`, no multi-stage build (already raised as F-SERVER-05 for the root user). Adding `USER deno` and `HEALTHCHECK CMD deno run --allow-net ./scripts/healthcheck.ts || exit 1` is a quick win.

### F-DOCKER-02 — `COPY core ./core` and `COPY server ./server` will pick up dotfiles (Low)

`Dockerfile` does not have an accompanying `.dockerignore`. `COPY core ./core` will include any local stray files — e.g. `.env`, editor state, `*.log`. Add `.dockerignore` excluding `.env*`, `*.log`, `__pycache__`, `node_modules`, `test_identities`, `*.identity.json`, `*.sqlite`.

### F-SECRETS-01 — No committed secrets observed (Informational)

A targeted scan for AWS keys (`AKIA…`), GitHub tokens (`ghp_…`, `gho_…`), JWTs (`eyJ…`), private-key PEM blocks, and `client_secret = "…"` patterns turned up no hits outside `node_modules/` and `wiki/raw/` content (which is third-party). The repo's `MAIL_OAUTH_*_CLIENT_ID` env vars are loaded from a *gitignored* `.env.desktop.build` (verified — `.gitignore` excludes `.env*`).

A full historical scan with `gitleaks` over `git log --all` is recommended for the final report — not run here because `gitleaks` is not installed in the audit environment.

### F-SECRETS-02 — `ebp.sqlite` and `test_identities/` shipped in repo (Informational)

The repo includes `ebp.sqlite` and `test_identities/` for development convenience. These contain test identities with **known passwords** documented in `wiki/raw/` notes. They are clearly labelled as test fixtures, but a careless reviewer could mistake them for real secrets. Add a top-of-file banner in `test_identities/README` warning that these are NOT secure.

### F-SUPPLY-01 — No reproducible build (Informational)

There is no documentation that a third party can reproduce the released AppImage / DMG / MSI binary byte-for-byte from the public source. Reproducible builds are EBP's only defense against a release-asset compromise of GitHub. This is a known gap and should be filed as a roadmap item.

## Tooling summary

| Tool | Status | Output |
|---|---|---|
| `deno lint core/` | clean | phase-02-deno-lint.txt |
| `deno lint server/` | warnings only | phase-03-deno-lint.txt |
| `deno lint gui/local-backend/` | 16 unused-var warnings | phase-04-deno-lint-gui-backend.txt |
| `npm audit` | 3 vulns | phase-06-npm-audit.txt + .json |
| `cargo audit` | 2 vulns + 15 unmaintained | phase-06-cargo-audit.txt |
| `gitleaks --no-git scan` | not installed; manual rg scan clean | — |

## Hand-off to Phase 7

Phase 7 covers the on-disk identity storage format — `~/.ebp/<name>.identity.json`, the AES-GCM private-key envelope, the PBKDF2 KDF parameters, and file permissions. The lockfile-pinned `@noble/ciphers` and `@noble/hashes` are clean here, so the question is whether EBP uses them with adequate iteration counts and salt sizes.

## Related Pages

- [[README]]
- [[findings]]
- [[phase-02-crypto-core]]
- [[phase-05-cli-website-tauri]]
