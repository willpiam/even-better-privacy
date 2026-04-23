---
name: wiki-ingest
description: Ingests a new source document into the EBP wiki by extracting key information, integrating it into existing pages, and updating cross-references. Use when the user says "ingest", "process raw sources", "ingest wiki/raw", drops files into wiki/raw/, or asks to add a new source to the wiki.
---

# Wiki Ingest

Integrate a new source document from `wiki/raw/` into the persistent wiki at `wiki/`, following the pattern described in `llm-wiki.md` and the conventions in `.cursor/rules/wiki-maintainer.mdc`.

## Prerequisites

- Source file exists under `wiki/raw/` (read-only; never modify).
- The always-applied `wiki-maintainer` rule provides taxonomy and frontmatter conventions. Follow them.

## Workflow

Work through these steps in order. For a single source this typically touches 5-15 wiki pages.

1. **Identify the source.** Confirm which file in `wiki/raw/` is being ingested. If multiple, ingest one at a time unless the user explicitly asks for batch mode.

2. **Read the source fully.** Large PDFs or long articles should be read with `Read` (use offset/limit for very large files). For images referenced in markdown, view them separately after reading the text.

3. **Discuss key takeaways briefly.** Surface the 3-5 most important claims, entities, or concepts with the user before writing. Confirm emphasis and scope before editing the wiki.

4. **Create or update the source-summary page.** File it as `wiki/source-<kebab-name>.md` with frontmatter:

```yaml
---
title: <Human-readable title>
type: source-summary
status: active
last_updated: <ISO date>
source_count: 1
tags: [<relevant-tags>]
---
```

Include a short `Sources` section citing the raw filename.

5. **Update affected pages across the wiki.** For each entity, concept, or component touched by the new source:
   - Add claims with citation back to the source-summary page.
   - Flag contradictions when new evidence conflicts with existing claims. Update both the old page and the new one, and note the contradiction explicitly.
   - Maintain `[[wikilinks]]` between pages.
   - Bump `last_updated` and `source_count` in frontmatter.

6. **Update `wiki/index.md`.** Add the new source-summary under `## Source Summaries` with a one-line description. Add any new entity/concept/component pages under their appropriate category. Update the `Last updated:` header.

7. **Append to `wiki/log.md`.** Use the exact prefix format so the log stays grep-parseable:

```
## [YYYY-MM-DD] ingest | <source-title>

- Ingested <raw filename> → [[source-<kebab-name>]].
- Updated: [[page-a]], [[page-b]], ...
- Contradictions noted: <if any, else omit>.
```

New entries go at the **top** of `log.md` (chronologically reverse), matching the existing pattern.

## Guardrails

- Never modify files under `wiki/raw/`.
- Never delete substantive content from existing pages without replacement.
- Prefer incremental edits over page rewrites.
- Cite claims. Every non-trivial fact should trace back to a source file path or a source-summary page.
- Flag uncertainty explicitly (e.g. "unclear from the source whether...").

## Verification checklist

Before finishing, confirm:

- [ ] Source-summary page exists and has valid frontmatter.
- [ ] All affected pages updated with citations and wikilinks.
- [ ] `wiki/index.md` reflects new/changed entries.
- [ ] `wiki/log.md` has a new entry at the top with `## [YYYY-MM-DD] ingest | ...` prefix.
- [ ] No orphan pages created (every new page has at least one inbound wikilink).
