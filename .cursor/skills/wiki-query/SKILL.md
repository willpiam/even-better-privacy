---
name: wiki-query
description: Answers questions against the EBP wiki by searching the index, reading relevant pages, synthesizing a cited response, and optionally filing durable analyses back into the wiki. Use when the user asks a substantive question about the EBP project (crypto schemes, components, identity model, revocation, audits) or explicitly says "query the wiki", "ask the wiki", or "check the wiki".
---

# Wiki Query

Answer questions using the persistent wiki at `wiki/` as the primary source, following the pattern in `llm-wiki.md` and the conventions in `.cursor/rules/wiki-maintainer.mdc`.

The wiki is the **compiled knowledge base** — use it before falling back to raw sources, web search, or generic reasoning.

## Workflow

1. **Read `wiki/index.md` first.** It is the catalog. Use it to identify which pages are relevant to the question. Do not skip this step — the index is how the wiki stays navigable at scale.

2. **Read the minimum set of linked pages.** Follow `[[wikilinks]]` from the index to the specific entity, concept, component, source-summary, or analysis pages needed. Prefer reading 3-5 focused pages over broad grep sweeps.

3. **Follow cross-references as needed.** If a page cites another page or a raw source that is critical to the answer, read it too. Stop expanding once you have enough to answer with confidence.

4. **Synthesize the answer with citations.** Every non-trivial claim should cite its wiki page (and optionally the underlying raw source). Use the format:

   - Inline: "ML-KEM-1024 provides NIST Level 5 security ([[ml-kem]])."
   - Footer `Sources:` section listing the wiki pages consulted.

5. **Flag gaps and uncertainty.** If the wiki does not answer the question, say so clearly. Suggest:
   - A raw source that could be ingested.
   - A new page that should be created.
   - A web search, if appropriate.

6. **Choose the response form.** Match the question:
   - Narrow factual question → short prose answer with citations.
   - Comparison → markdown table.
   - Deep analysis → structured sections (findings, evidence, implications).
   - Data-heavy → chart via code (not this skill's job to render, but suggest the format).

7. **File durable results back into the wiki.** If the answer has lasting value (a comparison, a synthesis, a discovered connection, a non-trivial analysis), file it as a new `analysis` page:

   - Filename: `wiki/analysis-<kebab-name>.md`
   - Frontmatter with `type: analysis`, `status: active`, ISO `last_updated`.
   - Add inbound links from the relevant entity/concept pages.
   - Add an entry under `## Analyses` in `wiki/index.md`.
   - Append to `wiki/log.md` (at the top):

     ```
     ## [YYYY-MM-DD] query | <question summary>

     - Answered: <one-line summary>.
     - Filed: [[analysis-<kebab-name>]].
     ```

   If the answer is ephemeral (e.g. "what's the filename for X"), do **not** file it. Only file analyses that compound the knowledge base.

## Decide whether to file

Ask: *"Will I or someone else want this answer again in three months?"*

- Yes → file as analysis.
- No → answer in chat only.

When unsure, ask the user.

## Guardrails

- Prefer wiki pages over raw sources when both cover the claim; the wiki is the synthesized truth.
- Never fabricate citations. If a claim is not in the wiki, say so.
- Do not edit entity/concept/component pages during query answering — that is the ingest skill's job. Query may only create new `analysis` pages and update `index.md` / `log.md`.
- Keep analysis pages focused (one primary concept per page); link outward rather than duplicating content.

## Verification checklist (when filing an analysis)

- [ ] New page has valid frontmatter.
- [ ] At least one inbound wikilink from an existing page.
- [ ] Listed in `wiki/index.md` under the right category.
- [ ] Log entry appended at top of `wiki/log.md` with `## [YYYY-MM-DD] query | ...` prefix.
