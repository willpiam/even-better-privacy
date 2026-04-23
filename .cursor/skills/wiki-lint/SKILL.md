---
name: wiki-lint
description: Performs a health check on the EBP wiki by auditing for orphan pages, stale content, broken wikilinks, missing cross-references, contradictions, and taxonomy gaps, then reports findings and applies safe fixes. Use when the user says "lint the wiki", "wiki health check", "audit the wiki", or asks to check wiki consistency.
---

# Wiki Lint

Run a systematic health check over `wiki/` following the pattern in `llm-wiki.md` and the conventions in `.cursor/rules/wiki-maintainer.mdc`.

The goal is to keep the wiki internally consistent, current, and well-linked as it grows.

## Workflow

Work through each check in order. Collect findings first; apply fixes second; report last.

### 1. Inventory the wiki

- List all pages under `wiki/` (exclude `wiki/raw/`).
- Read `wiki/index.md` and compare: every page should be listed, every listed page should exist.

### 2. Check for orphan pages

An orphan page has no inbound `[[wikilinks]]` from any other wiki page (and isn't a required top-level file like `index.md`, `log.md`, `overview.md`).

- Grep for `[[page-name]]` across `wiki/` for each page.
- Record pages with zero inbound links.
- Fix: add inbound links from the natural parent page (entity, concept, or index), or merge the orphan into a canonical page if it duplicates existing content.

### 3. Check for broken wikilinks

- Grep for all `[[...]]` patterns in wiki pages.
- For each target, confirm a matching file exists (accounting for `[[page|alias]]` and `[[folder/page]]` forms).
- Record broken links.
- Fix: correct the target, rename the link, or create the missing page as a seed stub with `status: seed`.

### 4. Check for stale pages

- Read frontmatter `last_updated` on every page.
- Flag pages where `last_updated` is significantly older than the most recent ingest that mentions related topics in `wiki/log.md`.
- Fix: re-read recent relevant sources and refresh claims, or mark `status: needs-review` and note in the lint report.

### 5. Check for missing high-value pages

Scan page bodies for terms that appear repeatedly (especially capitalized entities, scheme names, component names) but lack their own page.

- Fix: create seed pages for concepts referenced 3+ times across the wiki without a dedicated page.

### 6. Check for contradictions

Compare overlapping claims across related pages (e.g. same parameter set described in `source-*` and entity pages; same workflow described in `component-*` and `analysis-*`).

- Record contradictions.
- Fix: reconcile on both pages, cite the authoritative source, and note the contradiction resolution in `wiki/log.md`.

### 7. Check frontmatter hygiene

- Every non-log page should have the required fields (`title`, `type`, `status`, `last_updated`, `source_count`, `tags`).
- Flag missing or malformed frontmatter.
- Fix: add missing fields with conservative defaults (`status: needs-review` when unsure).

### 8. Check taxonomy alignment

Per `.cursor/rules/wiki-maintainer.mdc`, the wiki should organize around:
- Cryptographic schemes, identity model, revocation, components, security/design tradeoffs, testing/release workflows.

Flag pages that don't fit the taxonomy or belong in a different category in `index.md`.

### 9. Report and log

Write a concise lint report summarizing:
- Counts per category (orphans, broken links, stale, missing, contradictions, frontmatter issues).
- What was fixed automatically.
- What needs human input.

Append to `wiki/log.md` at the top:

```
## [YYYY-MM-DD] lint | wiki-health-check

- Orphans: <n> (fixed: <n>)
- Broken wikilinks: <n> (fixed: <n>)
- Stale pages: <n>
- Missing pages created as seeds: <n>
- Contradictions: <n> (resolved: <n>)
- Frontmatter issues: <n> (fixed: <n>)
- Notes: <anything needing human follow-up>
```

## Guardrails

- **Never delete substantive content** without a replacement. When in doubt, mark `status: needs-review` and report.
- **Do not silently rewrite claims** during lint — lint reconciles and flags; ingest is where new claims enter.
- **Preserve log append-only semantics.** The log grows; entries are not edited in place.
- Fix only low-risk issues automatically (broken link targets, missing frontmatter fields, orphan link additions). Surface ambiguous or substantive changes to the user for approval before applying.

## Useful shell checks

Quick commands for spotting common issues (via the Grep tool, not raw grep):

- Find all wikilinks: pattern `\[\[([^\]]+)\]\]`
- Find pages without frontmatter: pattern `^---` on first line; flag files that don't match.
- Find log entry prefixes: pattern `^## \[\d{4}-\d{2}-\d{2}\]` in `wiki/log.md`.

## Verification checklist

- [ ] All nine checks run.
- [ ] Findings collected before any fixes applied.
- [ ] Low-risk fixes applied; ambiguous items surfaced to user.
- [ ] Lint entry appended at top of `wiki/log.md` with `## [YYYY-MM-DD] lint | wiki-health-check` prefix.
- [ ] `wiki/index.md` updated if any pages were added, renamed, or recategorized.
