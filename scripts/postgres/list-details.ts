#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { coerceDbNumber, withClient } from "./_db.ts";
import { formatEpoch, parseLimit, parseOffset } from "./_format.ts";

const args = parseArgs(Deno.args, {
  boolean: ["help"],
  string: ["fingerprint", "limit", "offset"],
});

if (args.help) {
  console.log(`
List identity details.

Usage:
  ./scripts/postgres/list-details.ts --fingerprint=<fp>
  ./scripts/postgres/list-details.ts [--limit=100] [--offset=0]
`);
  Deno.exit(0);
}

const fingerprint = args.fingerprint;
const limit = parseLimit(args.limit, 100);
const offset = parseOffset(args.offset, 0);

const sql = fingerprint
  ? `
    SELECT id, identity_fingerprint, path, detail, created_at, verified_at, revoked_at
    FROM details
    WHERE identity_fingerprint = $1
    ORDER BY id ASC
    LIMIT $2 OFFSET $3
  `
  : `
    SELECT id, identity_fingerprint, path, detail, created_at, verified_at, revoked_at
    FROM details
    ORDER BY id ASC
    LIMIT $1 OFFSET $2
  `;

const params = fingerprint ? [fingerprint, limit, offset] : [limit, offset];

const rows = await withClient((client) => client.queryArray(sql, params));

const formatted = rows.map(([id, identityFingerprint, path, detail, createdAt, verifiedAt, revokedAt]) => ({
  id: coerceDbNumber(id),
  identity_fingerprint: String(identityFingerprint),
  path: String(path),
  detail: String(detail),
  created_at: formatEpoch(createdAt) ?? String(coerceDbNumber(createdAt) ?? ""),
  verified_at: formatEpoch(verifiedAt) ?? (coerceDbNumber(verifiedAt) ?? null),
  revoked_at: formatEpoch(revokedAt) ?? (coerceDbNumber(revokedAt) ?? null),
}));

console.table(formatted);
