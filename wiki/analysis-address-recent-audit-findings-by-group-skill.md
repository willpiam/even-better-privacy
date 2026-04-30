---
title: Analysis - Address Recent Audit Findings by Group Skill
type: analysis
status: active
last_updated: 2026-04-30
source_count: 2
tags: [audit, remediation, planning, skills, workflow]
---

# Analysis: Address Recent Audit Findings by Group Skill

This page documents the project skill `address-recent-audit-findings-by-group`, created to standardize how remediation planning is produced for unresolved audit findings that are above the `foo` threshold in the current findings plot workflow.

The skill is intentionally plan-oriented. It requires a planning-only output, enforces a strict Plan Mode gate, and blocks execution when Plan Mode is not enabled.

## What the skill standardizes

- Uses `plot_remaining_findings.py` as the source of truth for current `foo` threshold semantics.
- Uses the unresolved/open findings register in `wiki/security-audit-2026-04/findings.md`.
- Filters to findings above `foo`.
- Groups work primarily by component, then by remediation type.
- Produces a wave-based execution plan (Wave 1-3) with actions, validation, dependencies, and exit criteria.
- Ends with a maintenance step to remove solved-item handling (where applicable), rerun `python plot_remaining_findings.py`, and verify the refreshed above-`foo` set.

## Plan Mode enforcement behavior

The skill includes a hard gate that checks mode before analysis:

- If Plan Mode is not active, it must stop immediately.
- It must return: `This workflow requires Plan Mode. Please enable Plan Mode and run this request again.`
- It must not proceed with discovery or planning until Plan Mode is enabled.

## Related pages

- [[analysis-top-open-security-issues]]
- [[security-audit-2026-04/README]]
- [[security-audit-2026-04/findings]]

## Sources

- `.cursor/skills/address-recent-audit-findings-by-group/SKILL.md`
- `plot_remaining_findings.py`
