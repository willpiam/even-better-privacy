---
name: EBP LaTeX paper
overview: Add a `paper/` directory with a minimal LaTeX source (title, chosen subtitle, author) and a root `build_paper.sh` that runs `pdflatex` to produce `paper/main.pdf` on Ubuntu.
todos:
  - id: add-paper-dir
    content: Create paper/ and paper/main.tex with title, chosen subtitle, author (titling or fused \title)
    status: completed
  - id: add-build-script
    content: "Add root build_paper.sh: bash strict mode, cd paper, pdflatex main.tex"
    status: completed
isProject: false
---

# EBP protocol paper (LaTeX scaffold)

## Scope (this change set)

- Create [`paper/`](paper/) at the repository root: [`/home/william/projects/even-better-privacy/paper`](paper/).
- Add a single entry-point TeX file (recommended name: [`paper/main.tex`](paper/main.tex)) — not an exhaustive protocol write-up yet; only front matter: title **Even Better Privacy**, subtitle, author **William Doyle**.
- Add [`build_paper.sh`](build_paper.sh) at the repository root that invokes **pdfTeX** via `pdflatex` and fails loudly on errors.

## Subtitle (chosen)

Use: **“Post-quantum identity and secure messaging”** — aligns with [ReadMe.md](ReadMe.md) (“successor to PGP”, “quantum-secure”) and leaves room for later sections on identity, hierarchies, and email without overclaiming “formal spec”.

## LaTeX layout

- Use the standard `report` (or `article`) class so later chapters/sections map naturally to protocol topics (key generation, identity structure, hierarchy, blind/hashed details, fingerprints, formats).
- Use `\title{}`, `\author{}`, and `\date{}` (e.g. `\date{\today}` or empty `\date{}` if you prefer no date on the cover).
- For subtitle under the main title: `report`/`article` do not have `\subtitle` built-in — use either **`titling`** package (`\subtitle{...}`) or a small manual `\large` line after `\maketitle` / custom `titlepage` environment. Prefer **`titling`** for clean source.

Minimal structure:

```tex
\documentclass[11pt,a4paper]{report}
\usepackage{titling}
\title{Even Better Privacy}
\newcommand{\papersubtitle}{Post-quantum identity and secure messaging}
\renewcommand{\maketitlehooka}{\centering\large\papersubtitle\par\vspace{1em}}
\author{William Doyle}
% ... \begin{document} \maketitle \end{document}
```

(Alternative if you want to avoid an extra package: one-line `\usepackage{titling}` replaced by `\title{\textbf{Even Better Privacy}\\\large Post-quantum identity and secure messaging}` — fewer deps; either is fine; **titling** keeps title/subtitle semantics clear.)

## `build_paper.sh`

- Shebang: `#!/usr/bin/env bash`
- `set -euo pipefail`
- Resolve repo root: `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`
- `cd "$SCRIPT_DIR/paper"`
- Run: `pdflatex -interaction=nonstopmode -halt-on-error main.tex` (once is enough for a title-only doc; later add a second pass if you add TOC/bibliography).
- Optional: `chmod +x build_paper.sh` when committing (document in plan; user can `chmod +x` once).

Output: **`paper/main.pdf`** (default `pdflatex` behavior when run from `paper/`).

## Future expansion (not in this PR unless you ask)

- Outline sections matching your list: key generation/derivation, identity model, hierarchy, public vs blind/hashed details, fingerprint derivation, email encryption, on-wire/message formats — trace claims to implementation and [`wiki/`](wiki/) per project conventions.
- Add `.gitignore` under `paper/` for `*.aux`, `*.log`, `*.out`, `*.toc`, `*.synctex.gz` if auxiliary noise in `git status` becomes annoying.

## Files to add

| Path | Purpose |
|------|---------|
| [`paper/main.tex`](paper/main.tex) | LaTeX source (title page only for now) |
| [`build_paper.sh`](build_paper.sh) | Build `paper/main.pdf` with `pdflatex` |

No changes to existing application code or wiki required for this scaffold.
