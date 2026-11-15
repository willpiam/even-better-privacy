import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { registerStateAtomicityTests } from "./state_atomicity_cases.ts";

registerStateAtomicityTests(() =>
  Promise.resolve(new SqliteDatabaseAdapter(":memory:"))
);
