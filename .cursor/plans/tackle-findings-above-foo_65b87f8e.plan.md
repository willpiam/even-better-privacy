---
name: tackle-findings-above-foo
overview: Identify all open audit findings that plot above foo (y=8) and define an implementation order to remediate them efficiently.
todos:
  - id: server-hardening-above-foo
    content: Implement and test F-SERVER-06/07/10/11 fixes in server DB + handlers.
    status: completed
  - id: cli-hardening-above-foo
    content: Implement and test F-CLI-02/03/05 fixes for CLI argument and URL validation behavior.
    status: completed
  - id: web-gui-hardening-above-foo
    content: Implement F-WEB-02 and F-GUI-12 output/URL hardening with targeted regression checks.
    status: completed
  - id: core-compat-above-foo
    content: Implement F-CRYPTO-09/10 with compatibility-safe envelope and reason-length handling plus tests.
    status: completed
  - id: recompute-priority
    content: Regenerate findings plot and confirm above-foo set is reduced after remediations.
    status: completed
isProject: false
---

# Findings Above Foo (y=8) Remediation Plan

## Scope
`foo` is currently the horizontal line `y=8` on the findings scatter plot. “Above foo” is interpreted as findings with `ease_score > 8.00` in the current scoring output from `plot_remaining_findings.py`.

## Findings To Tackle
- `F-SERVER-06` (Medium): SQLite adapter does not set `PRAGMA foreign_keys = ON`.
- `F-SERVER-07` (Medium): Search `LIKE %query%` does not escape `%`/`_` wildcards.
- `F-WEB-02` (Medium): Website verifier accepts `http://` server URLs without warning/guard.
- `F-CLI-02` (Medium): `--password` flag allows secrets in shell history; warning hardening needed.
- `F-CLI-03` (Medium): Persisted `server` URL is not scheme-checked.
- `F-SERVER-10` (Low): Plaintext token compare is not constant-time in fallback mode.
- `F-CLI-05` (Informational): Unknown CLI flags are silently accepted.
- `F-CRYPTO-10` (Informational): No length cap on revocation `reason` string.
- `F-CRYPTO-09` (Low): Signed/encrypted inner JSON lacks explicit version/type tag.
- `F-GUI-12` (Low): Mail OAuth callback interpolates provider error text without HTML escaping.
- `F-SERVER-11` (Informational): Fingerprint validation side-effect call should be explicit.

## Execution Order
1. **Server safety fixes first** (`F-SERVER-06`, `F-SERVER-07`, `F-SERVER-10`, `F-SERVER-11`) because they affect shared backend behavior and are isolated code-path changes.
2. **CLI policy/validation fixes** (`F-CLI-02`, `F-CLI-03`, `F-CLI-05`) to harden user-facing operational paths.
3. **Website/GUI output hardening** (`F-WEB-02`, `F-GUI-12`) to reduce injection/misconfiguration risks.
4. **Core protocol robustness** (`F-CRYPTO-09`, `F-CRYPTO-10`) last, since these may require compatibility/versioning checks.

## Implementation Strategy
- Apply minimal, targeted patches per finding with regression tests colocated to each component.
- Prefer backward-compatible behavior gates for protocol-surface changes (`F-CRYPTO-09`, `F-CRYPTO-10`).
- Update findings status only after tests pass and behavior is verified in component-level checks.

## Key Files To Touch (anticipated)
- [/home/william/projects/even-better-privacy/server/db/]( /home/william/projects/even-better-privacy/server/db/ )
- [/home/william/projects/even-better-privacy/server/handlers/]( /home/william/projects/even-better-privacy/server/handlers/ )
- [/home/william/projects/even-better-privacy/cli/]( /home/william/projects/even-better-privacy/cli/ )
- [/home/william/projects/even-better-privacy/website/verify.js]( /home/william/projects/even-better-privacy/website/verify.js )
- [/home/william/projects/even-better-privacy/gui/local-backend/]( /home/william/projects/even-better-privacy/gui/local-backend/ )
- [/home/william/projects/even-better-privacy/core/]( /home/william/projects/even-better-privacy/core/ )

## Verification
- Re-run component test suites for touched areas (`server`, `cli`, `gui/local-backend`, `core`, `website` checks).
- Re-run `plot_remaining_findings.py` to confirm updated prioritization and whether these findings drop out of the “above foo” set.