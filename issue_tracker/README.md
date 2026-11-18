# Codebase issue tracker

Run from the repository root with Python 3.10 or newer:

```sh
python3 issue_tracker/server.py
```

Open http://127.0.0.1:8000 to view issues and add findings. All HTML is
rendered by Python; JavaScript and third-party packages are not required.
The Sort by dropdown reloads `/?sort=id` (newest first) or
`/?sort=criticality` (critical, then high, medium, and low; equal
criticality stays newest first). Choosing a value submits the form;
without JavaScript, use the Apply button. Each row is tinted by
criticality: rose, orange, amber, and violet. Green is not used.
Use `--port 8080` to choose another port, or `--data /path/to/issues.json`
to use a separate data file with the same structure.

`issues.json` stores open findings. Each issue has:

- `id`: positive integer, automatically assigned when submitted.
- `description`: required text, up to 10,000 characters. Include source paths,
  relevant lines, and reproduction details here when useful.
- `criticality`: `critical`, `high`, `medium`, or `low`.
- `category`: `correctness`, `efficiency`, or `code readability/maintainability`.

The top-level `next_id` counter persists across restarts. Keep it greater
than every existing ID; do not reduce it when removing issues manually.
Remove resolved entries rather than retaining a resolved flag or an archive
in this file. Always preserve `next_id`, even when the issue list becomes empty,
so previously assigned IDs are never reused.
Writes replace the JSON file atomically. Invalid existing data is never
silently reset. Stop the server before editing JSON manually, and run only
one server process per data file.

Resolved issues #1–#66 were removed after the holistic remediation. Their
descriptions remain in Git history, for example:

```sh
git show 8a2c25c:issue_tracker/issues.json
```

This is a local development tool without authentication. It binds to
127.0.0.1 by default. Keep it on a trusted local machine; public hosting
requires an authenticated production deployment.

## Initial code review

Issues #1–#8 were reviewed against commit
`aebe22c07393d3089ba0af34ff8fdf1bc52704bb`, in correctness, efficiency,
then maintainability order. This was a targeted review of mobile mail handling
and shared JSON parsing, not an exhaustive audit of the repository. Each
description includes the source location, impact, evidence, and suggested fix.

Run the four correctness reproductions with Node.js 24 or newer:

```sh
node issue_tracker/review_checks.mjs
```

The script loads and strips types from the actual TypeScript functions using
Node's built-in tools. Native transport and tracing dependencies are stubbed;
the SMTP check uses a scripted server reply sequence. These checks now assert corrected behavior for #1–#4: empty headers stay empty, failed IMAP commands reject, declared charsets decode correctly, and SMTP recipient replies 250/251/252 complete successfully.
Efficiency and maintainability findings are based on code inspection; no
benchmark speedup is claimed.


## Holistic remediation

[remediation_plan.md](remediation_plan.md) combines both holistic reviews into
an ordered implementation plan and a per-issue execution ledger. The original
reviews remain historical evidence; resolved issue descriptions are available
in Git history. The application CI
runs the production GUI dispatcher, Deno suites, mobile regressions, and the
desktop compiler; `npm run test:review-contracts` also covers the original
reproductions, wallet outcome handling, and FTP preview behavior.
