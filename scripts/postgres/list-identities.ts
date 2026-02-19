#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { coerceDbNumber, withClient } from "./_db.ts";
import { formatEpoch, parseLimit, parseOffset } from "./_format.ts";

const args = parseArgs(Deno.args, {
  boolean: ["help", "include-revoked"],
  string: ["limit", "offset"],
});

if (args.help) {
  console.log(`
List identities.

Usage:
  ./scripts/postgres/list-identities.ts [--limit=100] [--offset=0] [--include-revoked]
`);
  Deno.exit(0);
}

const limit = parseLimit(args.limit, 100);
const offset = parseOffset(args.offset, 0);
const includeRevoked = Boolean(args["include-revoked"]);

const sql = `
  SELECT fingerprint, signing_key_type, encryption_key_type, created_at, revoked_at
  FROM identities
  ${includeRevoked ? "" : "WHERE revoked_at IS NULL"}
  ORDER BY created_at DESC
  LIMIT $1 OFFSET $2
`;

const result = await withClient((client) => client.queryArray(sql, [limit, offset]));
const rows = result.rows;

const formatted = rows.map(([fingerprint, signingKeyType, encryptionKeyType, createdAt, revokedAt]) => ({
  fingerprint: String(fingerprint),
  signing_key_type: String(signingKeyType),
  encryption_key_type: String(encryptionKeyType),
  created_at: formatEpoch(createdAt) ?? String(coerceDbNumber(createdAt) ?? ""),
  revoked_at: formatEpoch(revokedAt) ?? (coerceDbNumber(revokedAt) ?? null),
}));

console.log(JSON.stringify(formatted, null, 2));
