---
name: discover-codebase-issues
description: Search this codebase for previously undocumented correctness, efficiency, and code readability/maintainability issues and append evidence-backed findings to issue_tracker/issues.json. Use when asked to discover issues, audit code quality, or find and record bugs without fixing them.
---

# Discover codebase issues

Find actionable, previously undocumented problems in the current source and record
them in `issue_tracker/issues.json`. Discovery and documentation only: do not fix
issues, refactor code, change dependencies, or create remediation plans.

## 1. Establish scope and existing knowledge

1. Work from the repository root. Read applicable repository instructions and
   inspect `git status --short` and the current commit. Preserve existing changes;
   inspect the working tree as it exists and identify uncommitted source in evidence.
2. Read `issue_tracker/README.md`, `issue_tracker/issues.json`, and the validation
   and persistence functions in `issue_tracker/server.py`. Validate the tracker
   with its existing `load_data` function before beginning. Never reset malformed
   or missing data; report the blocker instead.
3. Read `wiki/security-audit-2026-04/findings.md` and search relevant wiki pages,
   `.cursor/plans/`, source TODOs/FIXMEs, tests, and other local issue records for
   known problems. Include fixed and historical findings when checking novelty.
   Do not invoke a remediation or wiki-maintenance skill as part of this audit.
4. Honor any requested component, category, or time limit. Otherwise inventory
   first-party source and tests using `rg --files`, read `ReadMe.md`, `deno.json`,
   and relevant component documentation, and select a bounded review covering all
   three categories. Prefer areas less represented in existing records. Useful
   components include `core/`, `common/`, `server/`, `cli/`, `gui/`, `mobile/`,
   `desktop/`, `c-core/`, `python/`, and build/release scripts. Exclude dependencies,
   generated bundles, build outputs, and vendored code. Do not claim exhaustive
   coverage from a targeted review.

## 2. Investigate candidates

Use search to find candidates, then read complete functions, callers, error paths,
and related tests. A pattern match, lint warning, or stale comment is not proof.

- **Correctness:** trace parsing and serialization, boundary cases, state changes,
  async ordering, failure handling, cleanup, persistence, protocol behavior, and
  cross-component contracts. Establish the expected behavior from the actual
  contract, caller, test, or applicable specification.
- **Efficiency:** inspect repeated work, algorithmic complexity, allocations,
  unbounded growth, repeated I/O, query patterns, and blocking operations. Identify
  the actual call path and workload that make the cost relevant. State complexity
  or observed redundant work; do not invent benchmark numbers or speedup claims.
- **Code readability/maintainability:** identify concrete obstacles to safe changes
  or review, such as duplicated logic with diverging semantics, hidden invariants,
  misleading names, excessive coupling, or tangled responsibilities. Explain the
  practical maintenance consequence. Avoid personal formatting preferences,
  generic cleanup requests, and size or missing-test complaints without a specific
  risk demonstrated in the code.

For each candidate, identify the root cause, reachable trigger, exact source
locations, and consequence. Seek counterevidence: guards elsewhere, intentional
tradeoffs, upstream validation, and tests that establish intended behavior.
Discard candidates whose concern is resolved by that context.

Verify with a minimal reproduction or a focused existing test when useful and
feasible. Inspect commands before running them: some tasks start services, use
live credentials, send mail, or modify databases. Use isolated temporary data and
local stubs; avoid live services and destructive tasks. Temporary reproductions
belong in `work/` and must be removed before finishing. Do not add tracked test
files or modify application source. Record the actual result and any limits of
stubbing. If execution is unavailable, a complete source trace can establish a
finding; label it as code inspection. Do not record speculation as a confirmed
issue. Zero new findings is an acceptable result.

## 3. Require novelty and actionable evidence

Before accepting each finding, compare its root cause, affected behavior, and
locations with every existing tracker entry and relevant audit findings. Different
wording, another caller, or another symptom of the same root cause does not make
an issue new. Skip duplicates and already documented TODOs. A regression of a
historically fixed issue is eligible only with evidence that the current code
reintroduces it; reference the previous finding and explain the difference.

Use one entry per independent root cause, with the category that best describes
it. Do not split one issue across categories to inflate the count. Distinct
maintainability debt near a known bug is eligible only if its evidence and
consequences are independently actionable. There is no finding quota.

Assign criticality by demonstrated impact and realistic conditions:

- `critical`: catastrophic data loss, broad compromise, or system-wide failure
  under realistic conditions.
- `high`: serious incorrect behavior, substantial loss, or major workflow failure.
- `medium`: bounded incorrect behavior, meaningful workload-dependent resource
  waste, or substantial maintenance risk.
- `low`: limited impact or localized readability/maintenance friction.

Do not inflate criticality because a file is security-sensitive or hard to read.

## 4. Append findings using the existing tracker

Each record must have exactly the existing fields:

```json
{
  "id": 9,
  "description": "Short factual title. Location: relative/path.ts:10-24 (symbol). Trigger and expected versus actual behavior, or concrete maintenance consequence. Evidence: reproduction and observed result, or the complete source trace. Impact and relevant limits. Reviewed commit: <actual SHA>.",
  "criticality": "medium",
  "category": "correctness"
}
```

The example ID is illustrative; never hardcode it. Allowed categories are exactly
`correctness`, `efficiency`, and `code readability/maintainability`. Descriptions
must be nonempty and no longer than 10,000 characters. Include enough detail for
another developer to assess the finding without this conversation. Keep secrets,
private messages, and real credentials out of descriptions and reproductions.
Describe the problem and evidence; a fix or implementation plan is not required.

Only `issue_tracker/issues.json` may have a persistent change during a discovery
run. Preserve all prior entries, IDs, descriptions, and unknown fields. Do not
reclassify, resolve, delete, or rewrite existing findings.

Follow the README's single-writer rule: do not edit while the tracker server or
another writer is active. If exclusive writing cannot be established, report the
verified findings in chat and explain that persistence is blocked. Do not stop
someone else's server automatically.

Immediately before writing, reread and validate the latest JSON and repeat
deduplication against it. Use `add_issue` from `issue_tracker/server.py` (importable
with Python's `importlib.util`) for sequential writes: it assigns the current
`next_id`, increments the counter, validates inputs, and replaces the file
atomically. Never overwrite the tracker using a stale in-memory snapshot. If no
new findings survive review, leave the file unchanged.

## 5. Verify and report

Reload using `load_data`. Confirm unique positive integer IDs, a `next_id` greater
than every recorded ID, valid category and criticality values, description length
limits, and that every pre-existing record is unchanged. Inspect the final diff
to ensure only new findings and the corresponding counter increments were added;
check that no application source, tests, or dependency files changed during the
run. Preserve any changes that predated the audit.

Report added IDs with short titles, category, criticality, and source locations;
summarize reviewed scope, verification performed, duplicates skipped, and material
coverage or execution limits. If none were added, say so without asserting that
the codebase is issue-free. End after documenting findings; do not start fixing
them.
