# Codebase issue tracker

Run from the repository root with Python 3.10 or newer:

```sh
python3 issue_tracker/server.py
```

Open http://127.0.0.1:8000 to view issues and add findings. All HTML is
rendered by Python; JavaScript and third-party packages are not required.
Use `--port 8080` to choose another port, or `--data /path/to/issues.json`
to use a separate data file with the same structure.

`issues.json` stores the recorded findings. Each issue has:

- `id`: positive integer, automatically assigned when submitted.
- `description`: required text, up to 10,000 characters. Include source paths,
  relevant lines, and reproduction details here when useful.
- `criticality`: `critical`, `high`, `medium`, or `low`.
- `category`: `correctness`, `efficiency`, or `code readability/maintainability`.

The top-level `next_id` counter persists across restarts. Keep it greater
than every existing ID; do not reduce it when removing issues manually.
Writes replace the JSON file atomically. Invalid existing data is never
silently reset. Stop the server before editing JSON manually, and run only
one server process per data file.

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
the SMTP check uses a scripted server reply sequence. These are reproductions
of current flaws, so success means the reported behavior was confirmed, not
that those flaws have been fixed. Update the expectations when fixing them.
Efficiency and maintainability findings are based on code inspection; no
benchmark speedup is claimed.
