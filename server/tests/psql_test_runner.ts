import { loadSync } from "std/dotenv";

const testsArgs = [
  "test",
  "--allow-read",
  "--allow-write",
  "--allow-env",
  "--allow-net",
  "./server/tests",
];

const resultsDir = `${Deno.cwd()}/test-results`;
const logFile = `${resultsDir}/server-tests-psql.log`;
const stateFile = `${resultsDir}/server-tests-psql.json`;
const localDataDir = `${resultsDir}/server-tests-pgdata`;
const dockerContainer = "ebp-server-tests-postgres";

function ensureResultsDir(): void {
  Deno.mkdirSync(resultsDir, { recursive: true });
}

function log(message: string): void {
  ensureResultsDir();
  const line = `[psql-tests] ${new Date().toISOString()} ${message}\n`;
  Deno.writeTextFileSync(logFile, line, { append: true });
  console.error(line.trim());
}

let envLoaded = false;

function loadEnvOnce(): void {
  if (envLoaded) return;
  try {
    loadSync({ export: true });
  } catch {
    // ignore missing .env
  }
  envLoaded = true;
}

function envValue(key: string): string | undefined {
  const raw = Deno.env.get(key);
  if (raw === undefined) return undefined;
  return raw.trim();
}

function isPsqlMode(): boolean {
  const raw = (envValue("DB_TYPE") ?? envValue("DB_BACKEND") ?? "").toLowerCase();
  return raw === "psql" || raw === "postgres" || raw === "postgresql";
}

function dockerEnabled(): boolean {
  const raw = (envValue("SERVER_TESTS_USE_DOCKER") ?? "").toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function run(command: string, args: string[] = []): string {
  const output = new Deno.Command(command, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr);
    throw new Error(stderr.trim() || `Command failed: ${command}`);
  }
  return new TextDecoder().decode(output.stdout).trim();
}

function hasCommand(command: string): boolean {
  try {
    run("which", [command]);
    return true;
  } catch {
    return false;
  }
}

function canUseDocker(): boolean {
  try {
    run("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

function containerStatus(): string | null {
  try {
    const status = run("docker", [
      "ps",
      "-a",
      "--filter",
      `name=^/${dockerContainer}$`,
      "--format",
      "{{.Status}}",
    ]);
    return status || null;
  } catch {
    return null;
  }
}

async function waitForPostgresDocker(user: string): Promise<void> {
  const timeoutMs = 30_000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      run("docker", ["exec", dockerContainer, "pg_isready", "-U", user]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for postgres to become ready");
}

function getPort(): string {
  return envValue("PG_PORT") ?? "55432";
}

function getUser(): string {
  return envValue("PG_USER") ?? "postgres";
}

function getPassword(): string {
  const raw = Deno.env.get("PG_PASSWORD");
  if (raw === undefined) return "postgres";
  return raw.trim();
}

function getDatabase(): string {
  return envValue("PG_DATABASE") ?? "ebp";
}

async function provisionPostgres(): Promise<{ kind: "docker" | "local"; dataDir?: string }> {
  const host = envValue("PG_HOST") ?? "localhost";
  if (host !== "localhost" && host !== "127.0.0.1") {
    log(`skip provisioning: non-local host "${host}"`);
    return { kind: "local" };
  }

  if (dockerEnabled() && canUseDocker()) {
    const status = containerStatus();
    if (status) {
      log(`skip docker provisioning: container exists (${status})`);
      return { kind: "docker" };
    }
    const port = getPort();
    const user = getUser();
    const password = getPassword();
    const database = getDatabase();

    log("starting postgres via docker");
    run("docker", [
      "run",
      "-d",
      "--name",
      dockerContainer,
      "-e",
      `POSTGRES_USER=${user}`,
      "-e",
      `POSTGRES_PASSWORD=${password}`,
      "-e",
      `POSTGRES_DB=${database}`,
      "-p",
      `${port}:5432`,
      "postgres:16-alpine",
    ]);

    await waitForPostgresDocker(user);
    Deno.writeTextFileSync(
      stateFile,
      JSON.stringify({ kind: "docker", name: dockerContainer, startedByTests: true }, null, 2),
    );
    return { kind: "docker" };
  }

  if (!hasCommand("pg_ctl") || !hasCommand("initdb")) {
    log("skip local provisioning: pg_ctl/initdb not found");
    return { kind: "local" };
  }

  ensureResultsDir();
  try {
    Deno.statSync(localDataDir);
  } catch {
    log("initializing local postgres cluster");
    run("initdb", ["-D", localDataDir, "--auth=trust"]);
  }

  const port = getPort();
  log(`starting local postgres on port ${port}`);
  run("pg_ctl", ["-D", localDataDir, "-o", `-p ${port}`, "-w", "start"]);

  if (hasCommand("createdb")) {
    try {
      run("createdb", ["-h", "127.0.0.1", "-p", port, "-U", getUser(), getDatabase()]);
    } catch {
      // likely already exists
    }
  }

  Deno.writeTextFileSync(
    stateFile,
    JSON.stringify({ kind: "local", dataDir: localDataDir, startedByTests: true }, null, 2),
  );
  return { kind: "local", dataDir: localDataDir };
}

function teardown(): void {
  try {
    Deno.statSync(stateFile);
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(Deno.readTextFileSync(stateFile)) as {
      kind?: "docker" | "local";
      name?: string;
      dataDir?: string;
      startedByTests?: boolean;
    };
    if (!parsed.startedByTests) return;
    if (parsed.kind === "local") {
      const dataDir = parsed.dataDir ?? localDataDir;
      try {
        run("pg_ctl", ["-D", dataDir, "-m", "fast", "stop"]);
      } catch {
        // ignore if already stopped
      }
      try {
        Deno.removeSync(dataDir, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
      log("local postgres stopped");
    } else {
      const name = parsed.name ?? dockerContainer;
      try {
        run("docker", ["rm", "-f", name]);
      } catch {
        // ignore cleanup errors
      }
      log(`docker container removed: ${name}`);
    }
  } finally {
    try {
      Deno.removeSync(stateFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

async function runTests(env: Record<string, string>): Promise<number> {
  const command = new Deno.Command("deno", {
    args: testsArgs,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await command.spawn().status;
  return status.code;
}

loadEnvOnce();
const baseEnv = Deno.env.toObject();

if (!isPsqlMode()) {
  log("psql mode not detected; running tests without provisioning");
  const code = await runTests(baseEnv);
  Deno.exit(code);
}

log("psql mode detected; provisioning enabled");

const port = getPort();
const user = getUser();
const password = getPassword();
const database = getDatabase();

let exitCode = 1;
try {
  await provisionPostgres();
  const env = {
    ...baseEnv,
    DB_TYPE: "psql",
    PG_HOST: "127.0.0.1",
    PG_PORT: port,
    PG_USER: user,
    PG_PASSWORD: password,
    PG_DATABASE: database,
  };
  exitCode = await runTests(env);
} finally {
  teardown();
}

Deno.exit(exitCode);
