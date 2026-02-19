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
List revocations.

Usage:
  ./scripts/postgres/list-revocations.ts --fingerprint=<fp>
  ./scripts/postgres/list-revocations.ts [--limit=100] [--offset=0]
`);
  Deno.exit(0);
}

const fingerprint = args.fingerprint;
const limit = parseLimit(args.limit, 100);
const offset = parseOffset(args.offset, 0);

const sql = fingerprint
  ? `
    SELECT id, identity_fingerprint, type, target, nonce, certificate, created_at
    FROM revocations
    WHERE identity_fingerprint = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3
  `
  : `
    SELECT id, identity_fingerprint, type, target, nonce, certificate, created_at
    FROM revocations
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
  `;

const params = fingerprint ? [fingerprint, limit, offset] : [limit, offset];

const result = await withClient((client) => client.queryArray(sql, params));
const rows = result.rows;

const formatted = rows.map(([id, identityFingerprint, type, target, nonce, certificate, createdAt]) => ({
  id: coerceDbNumber(id),
  identity_fingerprint: String(identityFingerprint),
  type: String(type),
  target: target === null ? null : String(target),
  nonce: coerceDbNumber(nonce),
  certificate: String(certificate),
  created_at: formatEpoch(createdAt) ?? String(coerceDbNumber(createdAt) ?? ""),
}));

console.log(JSON.stringify(formatted, null, 2));
