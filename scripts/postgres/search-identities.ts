#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { coerceDbNumber, withClient } from "./_db.ts";
import { formatEpoch, parseLimit, parseOffset } from "./_format.ts";

const args = parseArgs(Deno.args, {
  boolean: ["help", "include-revoked"],
  string: ["query", "limit", "offset"],
});

if (args.help || !args.query) {
  console.log(`
Search identities by fingerprint, name, or email detail.

Usage:
  ./scripts/postgres/search-identities.ts --query=<text> [--limit=10] [--offset=0] [--include-revoked]
`);
  Deno.exit(args.query ? 0 : 1);
}

const query = String(args.query);
const limit = parseLimit(args.limit, 10);
const offset = parseOffset(args.offset, 0);
const includeRevoked = Boolean(args["include-revoked"]);

const like = `%${query.toLowerCase()}%`;
const baseJoin =
  "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email')";
const matchClause = "(LOWER(i.fingerprint) LIKE $1 OR LOWER(d.detail) LIKE $2)";
const revokedFilter = includeRevoked
  ? ""
  : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

const sql =
  `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at, i.revoked_at ` +
  `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT $3 OFFSET $4`;

const result = await withClient((client) => client.queryArray(sql, [like, like, limit, offset]));
const rows = result.rows;

const formatted = rows.map(([fingerprint, signingKeyType, encryptionKeyType, createdAt, revokedAt]) => ({
  fingerprint: String(fingerprint),
  signing_key_type: String(signingKeyType),
  encryption_key_type: String(encryptionKeyType),
  created_at: formatEpoch(createdAt) ?? String(coerceDbNumber(createdAt) ?? ""),
  revoked_at: formatEpoch(revokedAt) ?? (coerceDbNumber(revokedAt) ?? null),
}));

console.log(JSON.stringify(formatted, null, 2));
