---
title: "Querying the live key-server database"
type: analysis
status: active
last_updated: 2026-07-28
source_count: 3
tags:
  - analysis
  - server
  - postgres
  - ops
---

# Querying the live key-server database

## Verdict

From a developer workstation, query the live key-server Postgres (Render) with the Deno scripts under `scripts/postgres/`, after putting the external `DATABASE_URL` in the project-root `.env`. There is no separate bastion/SSH-tunnel tooling documented in-repo; connection is direct over TLS via the Render Postgres URL.

## What the live DB is

[[component-server]] stores publish/discovery state in SQLite (local default) or PostgreSQL (`DB_TYPE=psql`). Production is Postgres on Render (`ebp-cqyo.onrender.com` is the public API host referenced in project docs).

## Already set up

| Entry point | Purpose |
|---|---|
| `deno task query:prod:identities` | List identities (`scripts/postgres/list-identities.ts`) |
| `deno task query:prod:proposals` | List pending hierarchy proposals (certs omitted) |
| `deno task query:prod:all` | Dump all tables as JSON, long values truncated |
| `./scripts/postgres/list-details.ts` | Details for a fingerprint |
| `./scripts/postgres/list-revocations.ts` | Revocations for a fingerprint |
| `./scripts/postgres/list-proposals.ts` | Pending hierarchy proposals (`--fingerprint`, `--omit-certificate`) |
| `./scripts/postgres/search-identities.ts` | Search identities |
| `scripts/postgres/show-all.sql` | Example SQL (not auto-run) |
| `./scripts/postgres/reset-database.ts` | **Destructive** truncate + JSON backup |

Shared connection helper: `scripts/postgres/_db.ts`. It loads `.env` and accepts, in order:

1. `DATABASE_URL`
2. `RENDER_INTERNAL_DATABASE_URL`
3. `RENDER_DATABASE_URL`
4. `PG_URL`
5. Or discrete `PG_HOST` / `PG_PORT` / `PG_USER` / `PG_PASSWORD` / `PG_DATABASE`

TLS: URL `sslmode` (e.g. `require`) or overrides `PG_TLS` / `PG_TLS_ENFORCE`.

## Workstation recipe

1. Put the **external** Render Postgres URL in `.env` (not the internal hostname — that only works inside Render's network):

   ```
   DATABASE_URL=postgres://user:pass@host:5432/dbname?sslmode=require
   ```

2. Run a canned query:

   ```
   deno task query:prod:identities
   deno task query:prod:proposals
   deno task query:prod:all
   ./scripts/postgres/list-details.ts --fingerprint=<fp>
   ./scripts/postgres/list-proposals.ts --fingerprint=<fp>
   ```

3. For **ad-hoc SQL**, use `psql` with the same URL, or a short Deno one-liner using `withClient` from `_db.ts`. There is no dedicated `run-sql.ts` wrapper in the repo today.

## Caution

- Prefer read-only SQL against production.
- `reset-database.ts` truncates `identities`, `details`, and `revocations` after backup — not a routine inspect tool.
- Do not commit connection strings or `.env`.

## Gaps

- Wiki [[component-server]] documents schema adapters but not this ops path (covered here + `scripts/postgres/README.md`).
- No in-repo script that takes an arbitrary `--sql=...` argument.

## Sources

- `scripts/postgres/README.md`
- `scripts/postgres/_db.ts`, `list-*.ts`, `list-all.ts`
- `deno.json` (`query:prod:*` tasks)
- [[component-server]]
