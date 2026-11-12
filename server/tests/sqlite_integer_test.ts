import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";

Deno.test("SQLite preserves timestamps, negative integers, and unsafe 64-bit values", async () => {
  const db = new SqliteDatabaseAdapter(":memory:");
  try {
    await db.execute("CREATE TABLE integers (value INTEGER)");
    for (
      const value of [
        0,
        1,
        2 ** 31,
        -(2 ** 32),
        1_800_000_000_000,
        Number.MAX_SAFE_INTEGER,
        9_223_372_036_854_775_807n,
      ]
    ) {
      await db.query("INSERT INTO integers VALUES (?)", [value]);
    }
    assertEquals(await db.query("SELECT value FROM integers ORDER BY rowid"), [
      [0],
      [1],
      [2 ** 31],
      [-(2 ** 32)],
      [1_800_000_000_000],
      [Number.MAX_SAFE_INTEGER],
      [9_223_372_036_854_775_807n],
    ]);
  } finally {
    await db.close();
  }
});
