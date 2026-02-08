import { loadSync } from "std/dotenv";
import { Pool } from "postgres";

type TlsConfig = { enabled: true; enforce: boolean };

type DbConfig = {
  hostname: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolSize: number;
  tls?: TlsConfig;
};

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

function coerceNumber(value: string | number | null | undefined, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDatabaseUrl(rawUrl: string): { config: Omit<DbConfig, "poolSize" | "tls">; sslMode?: string } {
  const url = new URL(rawUrl);
  const sslMode = url.searchParams.get("sslmode") ?? undefined;
  return {
    config: {
      hostname: url.hostname,
      port: coerceNumber(url.port || "5432", 5432),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, "") || "postgres",
    },
    sslMode,
  };
}

function resolveTlsConfig(sslMode?: string): TlsConfig | undefined {
  const tlsOverride = Deno.env.get("PG_TLS");
  if (tlsOverride) {
    const enabled = tlsOverride.toLowerCase() === "true";
    if (!enabled) return undefined;
    const enforce = (Deno.env.get("PG_TLS_ENFORCE") ?? "false").toLowerCase() === "true";
    return { enabled: true, enforce };
  }

  if (!sslMode) return undefined;
  const normalized = sslMode.toLowerCase();
  if (normalized === "disable") return undefined;
  const enforce = normalized === "verify-ca" || normalized === "verify-full";
  return { enabled: true, enforce };
}

function loadDbConfig(): DbConfig {
  loadEnvOnce();
  const url =
    Deno.env.get("DATABASE_URL") ??
    Deno.env.get("RENDER_INTERNAL_DATABASE_URL") ??
    Deno.env.get("RENDER_DATABASE_URL") ??
    Deno.env.get("PG_URL");

  let baseConfig: Omit<DbConfig, "poolSize" | "tls">;
  let sslMode: string | undefined;
  if (url) {
    const parsed = parseDatabaseUrl(url);
    baseConfig = parsed.config;
    sslMode = parsed.sslMode;
  } else {
    baseConfig = {
      hostname: Deno.env.get("PG_HOST") ?? "localhost",
      port: coerceNumber(Deno.env.get("PG_PORT"), 5432),
      user: Deno.env.get("PG_USER") ?? "postgres",
      password: Deno.env.get("PG_PASSWORD") ?? "",
      database: Deno.env.get("PG_DATABASE") ?? "postgres",
    };
  }

  const poolSize = coerceNumber(Deno.env.get("PG_POOL_SIZE"), 5);
  const tls = resolveTlsConfig(sslMode);

  return { ...baseConfig, poolSize, tls };
}

export function createPool(): Pool {
  const config = loadDbConfig();
  const options = config.tls
    ? {
      hostname: config.hostname,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      tls: config.tls,
    }
    : {
      hostname: config.hostname,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
    };
  return new Pool(options, config.poolSize, true);
}

export async function withClient<T>(
  fn: (client: Awaited<ReturnType<Pool["connect"]>>) => Promise<T>,
): Promise<T> {
  const pool = createPool();
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export function coerceDbNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
