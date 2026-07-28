#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { coerceDbNumber, withClient } from "./_db.ts";
import { formatEpoch, parseLimit, parseOffset } from "./_format.ts";

const args = parseArgs(Deno.args, {
  boolean: ["help", "omit-certificate"],
  string: ["fingerprint", "limit", "offset"],
});

if (args.help) {
  console.log(`
List pending hierarchy proposals.

Usage:
  ./scripts/postgres/list-proposals.ts [--limit=100] [--offset=0]
  ./scripts/postgres/list-proposals.ts --fingerprint=<fp>
  ./scripts/postgres/list-proposals.ts --omit-certificate
`);
  Deno.exit(0);
}

const fingerprint = args.fingerprint;
const limit = parseLimit(args.limit, 100);
const offset = parseOffset(args.offset, 0);
const omitCertificate = Boolean(args["omit-certificate"]);

const sql = fingerprint
  ? `
    SELECT id, master_fingerprint, child_fingerprint, proposer_fingerprint,
           certificate, context, expiry, created_at
    FROM pending_hierarchy_proposals
    WHERE master_fingerprint = $1
       OR child_fingerprint = $1
       OR proposer_fingerprint = $1
    ORDER BY created_at DESC, id DESC
    LIMIT $2 OFFSET $3
  `
  : `
    SELECT id, master_fingerprint, child_fingerprint, proposer_fingerprint,
           certificate, context, expiry, created_at
    FROM pending_hierarchy_proposals
    ORDER BY created_at DESC, id DESC
    LIMIT $1 OFFSET $2
  `;

const params = fingerprint ? [fingerprint, limit, offset] : [limit, offset];

const result = await withClient((client) => client.queryArray(sql, params));
const rows = result.rows;

const formatted = rows.map(
  ([id, master, child, proposer, certificate, context, expiry, createdAt]) => {
    const row: Record<string, unknown> = {
      id: coerceDbNumber(id),
      master_fingerprint: String(master),
      child_fingerprint: String(child),
      proposer_fingerprint: String(proposer),
      context: String(context),
      expiry: formatEpoch(expiry) ?? (coerceDbNumber(expiry) ?? null),
      created_at: formatEpoch(createdAt) ?? String(coerceDbNumber(createdAt) ?? ""),
    };
    if (!omitCertificate) {
      row.certificate = String(certificate);
    }
    return row;
  },
);

console.log(JSON.stringify(formatted, null, 2));

const mostRecent = formatted[0]?.created_at ?? null;
console.error(
  `\n${formatted.length} proposal${formatted.length === 1 ? "" : "s"} listed` +
    (mostRecent != null ? `; most recent: ${mostRecent}` : ""),
);
