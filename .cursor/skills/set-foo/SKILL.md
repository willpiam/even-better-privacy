---
name: set-foo
description: Updates the foo function overlay in plot_remaining_findings.py from user-provided math syntax, with strict validation that the request is in terms of x and y. Use when the user asks to set, change, or redefine foo in the remaining findings plot.
disable-model-invocation: true
---

# Set Foo

Update `foo` in `plot_remaining_findings.py` only.

## Scope Lock

Allowed file:
- `plot_remaining_findings.py`

Allowed edit target:
- The foo overlay block in `main()` (the lines that define `y_vals` and the `ax.plot(... label=...)` foo label).

Hard constraint:
- Do not modify any other file.
- Do not modify any other part of `plot_remaining_findings.py`.

## Input Requirement

The requested foo definition must be in terms of `x` and `y`.

Accept common user syntaxes and infer intent when possible, including:
- `y = <expression in x>`
- `foo(x) = <expression in x>`
- `<equation containing x and y>` (for example: `x + y = 10`)

If the request is not in terms of `x` and `y`, reject and stop with:
- `Cannot set foo: expression must be in terms of x and y.`
- Include a short reason (for example: missing `x`, missing `y`, unsupported equation form, ambiguous syntax).

## Parsing and Validation Rules

1. Normalize input:
   - strip whitespace
   - lowercase function names
   - normalize `^` to `**`
   - treat `foo(x)=...` as `y=...`

2. Validate symbol usage:
   - `x` and `y` must both be present in the user equation form.
   - Reject if either variable is missing.

3. Infer a plottable `y` expression from `x`:
   - If already `y = f(x)`, use `f(x)`.
   - If form is a simple linear relation with one `y` term (for example `x + y = c`, `2y - x = c`), isolate `y`.
   - If safe isolation is not possible, reject and stop.

4. Safety:
   - Do not use `eval`.
   - Allow only numeric constants, `x`, operators, parentheses, and safe NumPy math functions already available via `np`.
   - Reject unknown identifiers.

## Edit Rules

When valid:
- Keep `x_vals` generation as-is unless a direct shape compatibility fix is required.
- Update only:
  - `y_vals = ...` to represent the inferred `y` expression over `x_vals`
  - foo legend label in `ax.plot(... label="...")` so it reflects the user definition

When invalid:
- Make no file changes.
- Return the rejection message and reason.

## Verification

After edit:
1. Confirm only `plot_remaining_findings.py` changed.
2. Confirm diff is limited to the foo overlay lines.
3. Run:
   - `python plot_remaining_findings.py`
4. If execution fails, revert only the attempted foo-line edits in that file and report the error.

## Response Contract

- On success: report the normalized foo equation and that only foo lines were changed.
- On rejection: report `Cannot set foo: expression must be in terms of x and y.` plus the reason.
