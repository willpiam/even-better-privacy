#!/usr/bin/env python3
"""Upload website/ over plain FTP. Credentials come from .env.

FTP has no rsync-style delta: a changed file is sent in full. It can report
size (MLSD or SIZE) but not a content hash. This script skips a file when the
remote size matches and the local SHA-256 matches the last upload recorded in
.deploy-ftp-state.json. Until that record exists, a same-size file is
downloaded once and hashed. That state file is gitignored.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from ftplib import FTP, error_perm, error_temp
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "website"
STATE_PATH = ROOT / ".deploy-ftp-state.json"
DEFAULT_REMOTE_DIR = "/williamdoyle.ca/ebp"


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
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
            os.environ.setdefault(key, value)


def env_required(name: str) -> str:
    value = (os.getenv(name) or "").strip().strip("'").strip('"')
    if not value:
        raise SystemExit(f"Missing required env var: {name}")
    return value


def env_optional(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip().strip("'").strip('"')


def skip_name(name: str) -> bool:
    return name in (".", "..") or name.startswith(".")


def remote_sha256(ftp: FTP, rel: str) -> str | None:
    """Hash a remote file via RETR. Used once per path, before a local record exists."""
    digest = hashlib.sha256()
    try:
        ftp.retrbinary(f"RETR {rel}", digest.update)
    except (error_perm, error_temp, OSError, EOFError):
        return None
    return digest.hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def upload_decision(
    *,
    present: bool,
    local_size: int,
    remote_size: int | None,
    local_hash: str | None,
    saved_hash: str | None,
    force: bool,
) -> bool:
    """True when STOR should replace the remote file."""
    if force or not present:
        return True
    if remote_size is None or remote_size != local_size:
        return True
    if saved_hash is None or local_hash is None:
        return True
    return local_hash != saved_hash


def load_state(path: Path, host: str, remote_dir: str) -> dict[str, str]:
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    if data.get("host") != host or data.get("remote") != remote_dir:
        return {}
    files = data.get("files")
    if not isinstance(files, dict):
        return {}
    return {
        key: value
        for key, value in files.items()
        if isinstance(key, str) and isinstance(value, str)
    }


def save_state(path: Path, host: str, remote_dir: str, files: dict[str, str]) -> None:
    payload = {"host": host, "remote": remote_dir, "files": files}
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def local_tree(site: Path) -> tuple[set[str], set[str]]:
    files: set[str] = set()
    dirs: set[str] = set()
    for path in site.rglob("*"):
        rel = path.relative_to(site)
        if any(skip_name(part) for part in rel.parts):
            continue
        posix = rel.as_posix()
        if path.is_dir():
            dirs.add(posix)
            continue
        if not path.is_file():
            continue
        files.add(posix)
        parent = rel.parent
        while parent.parts:
            dirs.add(parent.as_posix())
            parent = parent.parent
    return files, dirs


def ftp_size(ftp: FTP, rel: str) -> int | None:
    try:
        return ftp.size(rel)
    except (error_perm, error_temp, OSError, ValueError):
        return None


def listing_size(facts: dict[str, str]) -> int | None:
    raw = facts.get("size")
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def ftp_list(ftp: FTP, rel_dir: str) -> list[tuple[str, bool, int | None]]:
    path = rel_dir or "."
    try:
        entries: list[tuple[str, bool, int | None]] = []
        for name, facts in ftp.mlsd(path):
            if skip_name(name):
                continue
            is_dir = facts.get("type") == "dir"
            size: int | None = None
            if not is_dir:
                size = listing_size(facts)
                if size is None:
                    child = f"{rel_dir}/{name}" if rel_dir else name
                    size = ftp_size(ftp, child)
            entries.append((name, is_dir, size))
        return entries
    except (error_perm, AttributeError, OSError, ValueError):
        pass

    try:
        raw_names = ftp.nlst(path)
    except error_perm:
        return []

    cwd = ftp.pwd()
    result: list[tuple[str, bool, int | None]] = []
    for raw in raw_names:
        name = raw.rstrip("/").split("/")[-1]
        if skip_name(name):
            continue
        child = f"{rel_dir}/{name}" if rel_dir else name
        try:
            ftp.cwd(child)
            ftp.cwd(cwd)
            result.append((name, True, None))
        except error_perm:
            result.append((name, False, ftp_size(ftp, child)))
    return result


def remote_tree(ftp: FTP) -> tuple[dict[str, int | None], set[str]]:
    files: dict[str, int | None] = {}
    dirs: set[str] = set()

    def walk(rel: str) -> None:
        for name, is_dir, size in ftp_list(ftp, rel):
            child = f"{rel}/{name}" if rel else name
            if is_dir:
                dirs.add(child)
                walk(child)
            else:
                files[child] = size

    walk("")
    return files, dirs


def ensure_remote_dir(ftp: FTP, rel: str, known: set[str]) -> None:
    if not rel or rel in known:
        return
    parent = Path(rel).parent.as_posix()
    if parent != ".":
        ensure_remote_dir(ftp, parent, known)
    try:
        ftp.mkd(rel)
    except error_perm:
        pass
    known.add(rel)


def cwd_remote(ftp: FTP, remote_dir: str) -> None:
    try:
        ftp.cwd(remote_dir)
        return
    except error_perm:
        pass
    ftp.cwd("/")
    for part in (p for p in remote_dir.strip("/").split("/") if p):
        try:
            ftp.cwd(part)
        except error_perm:
            ftp.mkd(part)
            ftp.cwd(part)


def upload_file(ftp: FTP, local: Path, rel: str) -> None:
    with local.open("rb") as handle:
        ftp.storbinary(f"STOR {rel}", handle)


def prune_remote(
    ftp: FTP,
    local_files: set[str],
    local_dirs: set[str],
    remote_files: set[str],
    remote_dirs: set[str],
    dry_run: bool,
) -> tuple[int, int]:
    extra_files = sorted(remote_files - local_files)
    extra_dirs = sorted(remote_dirs - local_dirs, key=lambda p: p.count("/"), reverse=True)
    for rel in extra_files:
        print(f"  prune file {rel}")
        if not dry_run:
            ftp.delete(rel)
    for rel in extra_dirs:
        print(f"  prune dir  {rel}")
        if dry_run:
            continue
        try:
            ftp.rmd(rel)
        except error_perm as exc:
            print(f"    skip: {exc}")
    return len(extra_files), len(extra_dirs)


def site_ready() -> None:
    if not SITE.is_dir():
        raise SystemExit("website/ is missing.")
    files, _dirs = local_tree(SITE)
    if not files:
        raise SystemExit("website/ is empty.")


def connect(host: str, port: int, user: str, password: str, remote_dir: str) -> FTP:
    ftp = FTP()
    ftp.connect(host, port, timeout=30)
    ftp.login(user, password)
    ftp.set_pasv(True)
    try:
        ftp.voidcmd("TYPE I")
    except error_perm:
        pass
    cwd_remote(ftp, remote_dir)
    return ftp


def require_remote_dir(remote_dir: str) -> str:
    parts = [part for part in remote_dir.strip("/").split("/") if part]
    if len(parts) < 2:
        raise SystemExit(
            "FTP_REMOTE_DIR must be a subdirectory such as /williamdoyle.ca/ebp"
        )
    return "/" + "/".join(parts)


def deploy(dry_run: bool, force: bool) -> None:
    host = env_required("FTP_HOST")
    port_raw = env_optional("FTP_PORT", "21")
    try:
        port = int(port_raw)
    except ValueError:
        raise SystemExit(f"FTP_PORT must be an integer, got {port_raw!r}") from None
    user = env_required("FTP_USER")
    remote_dir = require_remote_dir(env_optional("FTP_REMOTE_DIR", DEFAULT_REMOTE_DIR))

    local_files, local_dirs = local_tree(SITE)
    print(f"Local:  {SITE} ({len(local_files)} files, {len(local_dirs)} dirs)")
    print(f"Remote: {user}@{host}:{port}{remote_dir}")

    password = env_required("FTP_PASSWORD")
    saved = {} if force else load_state(STATE_PATH, host, remote_dir)
    if force:
        print("Force: uploading every file.")
    elif not saved:
        print(
            "No upload record yet. Same-size files are downloaded once to compare "
            "contents; later deploys skip that."
        )

    ftp = connect(host, port, user, password, remote_dir)
    try:
        remote_files, remote_dirs = remote_tree(ftp)
        known_dirs = set(remote_dirs)
        for rel in sorted(local_dirs, key=lambda p: p.count("/")):
            if rel in known_dirs:
                continue
            print(f"  mkdir {rel}")
            if not dry_run:
                ensure_remote_dir(ftp, rel, known_dirs)

        uploaded = 0
        skipped = 0
        new_state: dict[str, str] = {}
        for rel in sorted(local_files):
            local = SITE / rel
            local_size = local.stat().st_size
            present = rel in remote_files
            remote_size = remote_files.get(rel)
            saved_hash = saved.get(rel)
            local_hash: str | None = None
            compared_hash = saved_hash
            if (
                not force
                and present
                and remote_size is not None
                and remote_size == local_size
            ):
                local_hash = file_sha256(local)
                if compared_hash is None:
                    compared_hash = remote_sha256(ftp, rel)
            if upload_decision(
                present=present,
                local_size=local_size,
                remote_size=remote_size,
                local_hash=local_hash,
                saved_hash=compared_hash,
                force=force,
            ):
                print(f"  upload {rel}")
                if not dry_run:
                    for attempt in range(4):
                        try:
                            upload_file(ftp, local, rel)
                            break
                        except (EOFError, OSError, error_temp) as exc:
                            if attempt == 3:
                                raise
                            print(f"    retry {rel} ({exc.__class__.__name__})")
                            try:
                                ftp.close()
                            except OSError:
                                pass
                            ftp = connect(host, port, user, password, remote_dir)
                    new_state[rel] = local_hash or file_sha256(local)
                uploaded += 1
            else:
                print(f"  skip   {rel}")
                skipped += 1
                if local_hash is not None:
                    new_state[rel] = local_hash

        n_files, n_dirs = prune_remote(
            ftp,
            local_files,
            local_dirs,
            set(remote_files),
            remote_dirs,
            dry_run=dry_run,
        )
        if not dry_run:
            save_state(STATE_PATH, host, remote_dir, new_state)
        verb = "Would upload" if dry_run else "Uploaded"
        print(
            f"Done. {verb} {uploaded} files, skipped {skipped} unchanged, "
            f"pruned {n_files} files and {n_dirs} dirs."
        )
    finally:
        try:
            ftp.quit()
        except (OSError, EOFError):
            ftp.close()


def check_settings() -> None:
    host = env_required("FTP_HOST")
    user = env_required("FTP_USER")
    env_required("FTP_PASSWORD")
    port_raw = env_optional("FTP_PORT", "21")
    try:
        port = int(port_raw)
    except ValueError:
        raise SystemExit(f"FTP_PORT must be an integer, got {port_raw!r}") from None
    remote_dir = require_remote_dir(env_optional("FTP_REMOTE_DIR", DEFAULT_REMOTE_DIR))
    print(f"FTP settings found for {user}@{host}:{port}{remote_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload website/ over FTP.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Connect and print uploads, skips, and prunes without changing the server.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Upload every file, ignoring size and the saved content hashes.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Confirm FTP settings are present without connecting.",
    )
    args = parser.parse_args()

    load_env_file(ROOT / ".env")
    if args.check:
        check_settings()
        return
    site_ready()
    deploy(dry_run=args.dry_run, force=args.force)


if __name__ == "__main__":
    main()
