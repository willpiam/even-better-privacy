#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env --allow-net

import { parseArgs } from "@std/cli/parse-args";
import { withClient } from "./_db.ts";

const args = parseArgs(Deno.args, {
  boolean: ["yes"],
  string: ["backup-dir"],
  default: {
    yes: false,
  },
});

function timestampSlug(): string {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function ensureDir(path: string): Promise<void> {
  await Deno.mkdir(path, { recursive: true });
}

function jsonWithBigInt(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
}

async function backupTable(client: Awaited<ReturnType<import("postgres").Pool["connect"]>>, table: string, backupDir: string): Promise<number> {
  const rows = await client.queryObject(`SELECT * FROM ${table}`);
  const path = `${backupDir}/${table}.json`;
  await Deno.writeTextFile(path, jsonWithBigInt(rows.rows));
  return rows.rows.length;
}

async function main(): Promise<void> {
  if (!args.yes) {
    const confirmation = prompt(
      "This will reset the database and delete all current rows after backup. Type yes to continue:",
    );
    if (confirmation !== "yes") {
      console.error("Aborted. Confirmation was not exactly 'yes'.");
      Deno.exit(1);
    }
  }

  const backupDir = args["backup-dir"] ? String(args["backup-dir"]) : `./scripts/postgres/backups/reset-${timestampSlug()}`;
  await ensureDir(backupDir);

  await withClient(async (client) => {
    console.log(`Creating backup in ${backupDir}`);

    const identitiesCount = await backupTable(client, "identities", backupDir);
    const detailsCount = await backupTable(client, "details", backupDir);
    const revocationsCount = await backupTable(client, "revocations", backupDir);

    await client.queryArray("BEGIN");
    try {
      await client.queryArray("TRUNCATE TABLE details, revocations, identities RESTART IDENTITY CASCADE");
      await client.queryArray("COMMIT");
    } catch (e) {
      await client.queryArray("ROLLBACK");
      throw e;
    }

    console.log("Reset complete.");
    console.log(`- identities removed: ${identitiesCount}`);
    console.log(`- details removed: ${detailsCount}`);
    console.log(`- revocations removed: ${revocationsCount}`);
    console.log(`- backup: ${backupDir}`);
  });
}

if (import.meta.main) {
  await main();
}

