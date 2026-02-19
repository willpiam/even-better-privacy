#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { parseArgs } from "@std/cli/parse-args";
import { withClient } from "./_db.ts";

const args = parseArgs(Deno.args, {
  boolean: ["help", "truncate-long-values"],
  string: ["schema"],
});

if (args.help) {
  console.log(`
Dump all rows from every table in a schema as JSON.

Usage:
  ./scripts/postgres/list-all.ts [--schema=public] [--truncate-long-values]
`);
  Deno.exit(0);
}

const schema = args.schema ? String(args.schema) : "public";
const truncateLongValues = Boolean(args["truncate-long-values"]);
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
  console.error(`Invalid schema name: ${schema}`);
  Deno.exit(1);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function maybeTruncateLongValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (!truncateLongValues || typeof value !== "string") {
    return value;
  }
  const bytes = encoder.encode(value);
  if (bytes.length <= 256) {
    return value;
  }
  const first = decoder.decode(bytes.slice(0, 32));
  const last = decoder.decode(bytes.slice(-32));
  return `${first}...${bytes.length} bytes...${last}`;
}

const dump = await withClient(async (client) => {
  const tableResult = await client.queryArray<[string]>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
     ORDER BY table_name ASC`,
    [schema],
  );

  const output: Record<string, Record<string, unknown>[]> = {};

  for (const [tableNameValue] of tableResult.rows) {
    const tableName = String(tableNameValue);
    const escapedTableName = tableName.replaceAll('"', '""');
    const rowsResult = await client.queryObject<Record<string, unknown>>(
      `SELECT * FROM "${escapedTableName}"`,
    );
    output[tableName] = rowsResult.rows;
  }

  return output;
});

console.log(JSON.stringify(dump, (_key, value) => maybeTruncateLongValue(value), 2));
