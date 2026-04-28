// =============================================================================
// CORS Configuration
// =============================================================================

const DEFAULT_ALLOWED_ORIGINS = "http://127.0.0.1:8787,http://localhost:8787";

export const RAW_ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? DEFAULT_ALLOWED_ORIGINS)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const EXPECTED_HOSTS_RAW = (Deno.env.get("EXPECTED_HOSTS") ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

export function isHostAllowed(hostHeader: string | null): boolean {
  if (EXPECTED_HOSTS_RAW.length === 0) return true;
  if (!hostHeader) return false;
  const host = hostHeader.trim().toLowerCase().split(":")[0];
  return EXPECTED_HOSTS_RAW.includes(host);
}

// =============================================================================
// HSTS Configuration (optional; enabled via env)
// =============================================================================

export const HSTS_ENABLED = (Deno.env.get("HSTS_ENABLED") ?? "false").toLowerCase() === "true";
export const HSTS_MAX_AGE = Number(Deno.env.get("HSTS_MAX_AGE") ?? "31536000"); // 1 year
export const HSTS_INCLUDE_SUBDOMAINS = (Deno.env.get("HSTS_INCLUDE_SUBDOMAINS") ?? "false").toLowerCase() === "true";

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser or same-origin
  if (RAW_ALLOWED_ORIGINS.includes("*")) return true;
  return RAW_ALLOWED_ORIGINS.some((o) => o === origin);
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = RAW_ALLOWED_ORIGINS.includes("*")
    ? "*"
    : (origin && isOriginAllowed(origin) ? origin : "");

  const headers: Record<string, string> = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (allowOrigin) {
    headers["access-control-allow-origin"] = allowOrigin;
  }

  return headers;
}

export function buildSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
  if (HSTS_ENABLED) {
    headers["strict-transport-security"] = `max-age=${HSTS_MAX_AGE}` +
      (HSTS_INCLUDE_SUBDOMAINS ? "; includeSubDomains" : "");
  }
  return headers;
}
