#!/usr/bin/env python3
"""Run a command with only the Cloudflare credentials from .env.

The rest of .env (mail passwords and other app secrets) is not copied into
the child environment.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.is_file():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        if text.startswith("export "):
            text = text[len("export ") :]
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            env[key] = value
    return env


def account_id(token: str, configured: str) -> str:
    if configured:
        return configured
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)
    if not payload.get("success"):
        raise SystemExit("Cloudflare account lookup failed. Set CLOUDFLARE_ACCOUNT_ID in .env.")
    accounts = payload.get("result") or []
    if len(accounts) != 1 or not accounts[0].get("id"):
        raise SystemExit("Set CLOUDFLARE_ACCOUNT_ID in .env.")
    return str(accounts[0]["id"])


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: with_cloudflare_env.py COMMAND [ARG ...]")
    file_env = load_env_file(ROOT / ".env")
    token = (os.environ.get("CLOUDFLARE_API_TOKEN") or file_env.get("CLOUDFLARE_API_TOKEN") or "").strip()
    if not token:
        raise SystemExit("Missing required env var: CLOUDFLARE_API_TOKEN")
    configured = (os.environ.get("CLOUDFLARE_ACCOUNT_ID") or file_env.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    os.environ["CLOUDFLARE_API_TOKEN"] = token
    os.environ["CLOUDFLARE_ACCOUNT_ID"] = account_id(token, configured)
    os.environ["WRANGLER_SEND_METRICS"] = "false"
    os.environ["WRANGLER_SEND_ERROR_REPORTS"] = "false"
    os.environ["CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV"] = "false"
    os.environ["npm_config_update_notifier"] = "false"
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
