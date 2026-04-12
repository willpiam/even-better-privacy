// =============================================================================
// CORS Configuration
// =============================================================================

export const RAW_ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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
  const headers: Record<string, string> = {};
  if (HSTS_ENABLED) {
    headers["strict-transport-security"] = `max-age=${HSTS_MAX_AGE}` +
      (HSTS_INCLUDE_SUBDOMAINS ? "; includeSubDomains" : "");
  }
  return headers;
}
