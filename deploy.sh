#!/usr/bin/env bash
# Deploy website/ to the pqpost.com Cloudflare Worker and to williamdoyle.ca over FTP.
#
# Reads secrets from .env. Nothing in this script belongs in git except the
# variable names:
#   CLOUDFLARE_API_TOKEN          required for Cloudflare
#   CLOUDFLARE_ACCOUNT_ID         optional; looked up when the token sees one account
#   FTP_HOST FTP_USER FTP_PASSWORD   required for FTP
#   FTP_REMOTE_DIR                optional, default /williamdoyle.ca/ebp
#   FTP_PORT                      optional, default 21
#
# Cloudflare stores a hash for each asset and uploads only missing blobs.
# FTP skips a file when its size and SHA-256 match .deploy-ftp-state.json.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

dry_run=0
force=0
do_cf=1
do_ftp=1

usage() {
  echo "Usage: ./deploy.sh [--dry-run] [--force] [--cloudflare-only | --ftp-only]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --force) force=1 ;;
    --cloudflare-only) do_ftp=0 ;;
    --ftp-only) do_cf=0 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [[ "$do_cf" -eq 0 && "$do_ftp" -eq 0 ]]; then
  echo "Pass only one of --cloudflare-only or --ftp-only." >&2
  exit 2
fi

if [[ "$do_cf" -eq 1 && "$do_ftp" -eq 0 && "$force" -eq 1 ]]; then
  echo "--force only changes the FTP upload. Cloudflare already skips stored asset hashes." >&2
fi

if [[ "$do_ftp" -eq 1 ]]; then
  python3 "$ROOT/scripts/deploy_ftp.py" --check
fi

if [[ "$do_cf" -eq 1 ]]; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    echo "Node 22 is required. nvm was not found at $NVM_DIR." >&2
    exit 1
  fi
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use 22 >/dev/null
  cf_args=(deploy --keep-vars --no-autoconfig)
  if [[ "$dry_run" -eq 1 ]]; then
    cf_args+=(--dry-run)
  fi
  echo "Cloudflare: worker misty-bonus-b0ce (website/)"
  python3 "$ROOT/scripts/with_cloudflare_env.py" \
    npx --yes wrangler@4.152.0 "${cf_args[@]}"
fi

if [[ "$do_ftp" -eq 1 ]]; then
  ftp_args=()
  if [[ "$dry_run" -eq 1 ]]; then
    ftp_args+=(--dry-run)
  fi
  if [[ "$force" -eq 1 ]]; then
    ftp_args+=(--force)
  fi
  python3 "$ROOT/scripts/deploy_ftp.py" "${ftp_args[@]}"
fi
