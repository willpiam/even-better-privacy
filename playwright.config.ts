import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const e2eHome = `${process.cwd()}/test-results/e2e-home`;
const e2eServerDb = `${process.cwd()}/test-results/e2e-server.sqlite`;
const e2eServerUrl = "http://localhost:8788/api/v1/health";

function loadDotEnv(): void {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const systemSqlitePath = [
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so",
  "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0",
  "/usr/lib64/libsqlite3.so",
  "/usr/lib/libsqlite3.so",
].find((candidate) => fs.existsSync(candidate));
const denoSqlitePath = process.env.DENO_SQLITE_PATH ?? systemSqlitePath;

const dbType = (process.env.DB_TYPE ?? process.env.DB_BACKEND ?? "sqlite").toLowerCase();
const usePostgres = dbType === "psql" || dbType === "postgres" || dbType === "postgresql";

// For e2e tests, always use port 55432 to avoid conflicts with system postgres
const E2E_PG_PORT = process.env.PG_PORT ?? "55432";
const pgConfig = {
  host: process.env.PG_HOST ?? "localhost",
  port: E2E_PG_PORT,
  user: process.env.PG_USER ?? "postgres",
  password: process.env.PG_PASSWORD ?? "postgres",
  database: process.env.PG_DATABASE ?? "ebp",
  poolSize: process.env.PG_POOL_SIZE ?? "5",
};

export default defineConfig({
  testDir: "./gui/e2e",
  testIgnore: ["**/global.setup.ts"],
  // Keep artifacts out of the shared test-results root so a Playwright run
  // does not wipe mobile-e2e SQLite/logs (or other runners) mid-flight.
  outputDir: "./test-results/playwright",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: "http://localhost:8787",
    trace: "on-first-retry",
    video: "on",
  },
  webServer: [
    {
      command: "deno task gui",
      url: "http://localhost:8787",
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        HOME: e2eHome,
        ...(denoSqlitePath ? { DENO_SQLITE_PATH: denoSqlitePath } : {}),
      },
    },
    {
      command: "deno task server",
      url: e2eServerUrl,
      reuseExistingServer: true,
      timeout: 30_000,
      env: {
        PORT: "8788",
        DB_PATH: e2eServerDb,
        RATE_LIMIT_DISABLED: "true",
        ...(denoSqlitePath ? { DENO_SQLITE_PATH: denoSqlitePath } : {}),
        ...(usePostgres
          ? {
            DB_TYPE: "psql",
            PG_HOST: pgConfig.host,
            PG_PORT: pgConfig.port,
            PG_USER: pgConfig.user,
            PG_PASSWORD: pgConfig.password,
            PG_DATABASE: pgConfig.database,
            PG_POOL_SIZE: pgConfig.poolSize,
          }
          : {
            DB_TYPE: "sqlite",
          }),
      },
    },
  ],
});
