import { PostgresDatabaseAdapter } from "../db/postgres.ts";
import { registerStateAtomicityTests } from "./state_atomicity_cases.ts";

if (Deno.env.get("RUN_POSTGRES_ATOMICITY") === "true") {
  registerStateAtomicityTests(async () => {
    const db = PostgresDatabaseAdapter.createFromEnv();
    await db.initializeSchema();
    return db;
  });
} else {
  Deno.test({
    name: "PostgreSQL state atomicity (set RUN_POSTGRES_ATOMICITY=true)",
    ignore: true,
    fn() {},
  });
}
