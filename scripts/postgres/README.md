# Postgres query scripts

This folder contains small Deno scripts for querying the Postgres database (e.g. Render).

## Setup

Provide connection details via environment variables. Scripts load `.env` automatically.

Supported connection variables:

- `DATABASE_URL` (preferred) or `RENDER_INTERNAL_DATABASE_URL` or `RENDER_DATABASE_URL`
- Or individual values: `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`
- Optional TLS overrides: `PG_TLS=true|false`, `PG_TLS_ENFORCE=true|false`
- Optional: `PG_POOL_SIZE` (default `5`)

Example `.env`:

```
DATABASE_URL=postgres://user:pass@host:5432/dbname?sslmode=require
```

## Usage

Run scripts with Deno (each script includes a shebang):

```
./scripts/postgres/list-identities.ts --limit=50
./scripts/postgres/list-details.ts --fingerprint=abc123
./scripts/postgres/list-revocations.ts --fingerprint=abc123
./scripts/postgres/search-identities.ts --query=alice
```

Use `--help` on any script for options.
