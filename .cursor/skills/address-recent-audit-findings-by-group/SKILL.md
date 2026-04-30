---
name: address-recent-audit-findings-by-group
description: Produces an implementation plan to address remaining audit findings grouped by category, filtered to items above the foo threshold from plot_remaining_findings.py. Use when the user asks to plan remediation of unresolved audit findings, prioritize findings above foo, or organize audit work by group/component.
---

# Address Recent Audit Findings By Group

Produce a remediation **plan** for unresolved audit findings that are above `foo`, grouped into actionable buckets.

## Hard gate: Plan Mode only

Before any analysis:

1. Check whether the agent is currently in Plan Mode.
2. If not in Plan Mode, immediately stop and respond with:
   - `This workflow requires Plan Mode. Please enable Plan Mode and run this request again.`
3. Do not continue with discovery, ranking, or planning until Plan Mode is enabled.

## Inputs to use

- `plot_remaining_findings.py` (for the current `foo` definition and ranking semantics)
- `wiki/security-audit-2026-04/findings.md` (source of unresolved findings and statuses)
- `wiki/index.md` and linked audit pages as needed for context and dependencies

## Workflow

1. Confirm the `foo` threshold from `plot_remaining_findings.py`.
   - Do not assume a hardcoded threshold; read the script and use the current definition.
   - Respect the normalized/ranked model where extrema are anchored across unresolved items.

2. Build the candidate set.
   - Use only unresolved/open findings.
   - Filter to findings above `foo` using the script's semantics.
   - Require at least one TODO item per included finding

3. Group findings for execution.
   - Primary grouping: `component`.
   - Secondary grouping inside each component: remediation type (code fix, configuration, test coverage, docs/process).
   - Preserve finding IDs in each group.

4. Produce a prioritized plan.
   - Sequence groups by risk reduction first, then ease/parallelizability.
   - Every finding in scope should usually appear as its own distinct TODO item with a checkbox. Only when there is very good reason to do otherwise should you. 
   - For each group, provide:
     - goal
     - included findings (IDs + short titles)
     - concrete actions
     - owner suggestion (if inferable, otherwise mark TBD)
     - validation/tests
     - dependencies/blockers
     - exit criteria

5. Add implementation waves.
   - Wave 1: highest risk and low coordination
   - Wave 2: medium risk or medium coordination
   - Wave 3: structural or cross-cutting work
   - Include expected ordering rationale.

6. End with maintenance actions.
   - Include a final explicit step to remove solved items from `plot_remaining_findings.py` (if any script-side solved-item handling exists), then rerun:
   - `python plot_remaining_findings.py`
   - Confirm regenerated output artifact path and that remaining items still above `foo` are re-evaluated.

## Output format

Use this exact section structure:

```markdown
# Plan: Address Audit Findings Above foo

## Scope and Threshold
- foo definition:
- included findings count:
- excluded findings count:

## Grouped Findings
### <Component Group>
- Findings:
- Remediation type(s):
- Why this group matters:

## TODO Items (One Per Finding)
- [ ] <FINDING_ID>: <short title> (Group: <component>, Wave: <1|2|3>)
- [ ] <FINDING_ID>: <short title> (Group: <component>, Wave: <1|2|3>)

## Execution Plan
### Wave 1
- Group(s):
- Actions:
- Validation:
- Exit criteria:

### Wave 2
- Group(s):
- Actions:
- Validation:
- Exit criteria:

### Wave 3
- Group(s):
- Actions:
- Validation:
- Exit criteria:

## Dependencies and Risks
- Dependencies:
- Blockers:
- Risk notes:

## Finalization
- Remove solved-item handling from `plot_remaining_findings.py` (where applicable).
- Rerun `python plot_remaining_findings.py`.
- Verify refreshed remaining-findings output and new above-foo set.
```

## Guardrails

- Do not propose code edits when this workflow is invoked; output a plan only.
- If data needed for grouping/filtering is missing, state assumptions explicitly.
- Keep findings traceable by ID in all plan sections.
