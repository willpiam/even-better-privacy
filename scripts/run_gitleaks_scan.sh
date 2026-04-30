#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is required for F-SECRETS-01. Install it from https://github.com/gitleaks/gitleaks." >&2
  exit 127
fi

mkdir -p wiki/security-audit-2026-04/tooling-output
gitleaks detect \
  --redact \
  --config .gitleaks.toml \
  --report-format json \
  --report-path wiki/security-audit-2026-04/tooling-output/gitleaks-history.json
