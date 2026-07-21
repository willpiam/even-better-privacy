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

/**
 * Returns true when `origin` may call the API.
 *
 * Browsers send Origin even for same-origin fetch/POST (e.g. the verify-email
 * confirmation page). The old comment assumed missing Origin meant same-origin;
 * that is false — same-origin must be detected explicitly.
 */
export function isOriginAllowed(origin: string | null, req?: Request): boolean {
  if (!origin) return true; // non-browser clients
  if (RAW_ALLOWED_ORIGINS.includes("*")) return true;
  if (RAW_ALLOWED_ORIGINS.some((o) => o === origin)) return true;

  // Same-origin: verify-email HTML is served by this server and POSTs back to
  // itself. Behind TLS terminators, req.url may be http while Origin is https,
  // so also match PUBLIC_BASE_URL and Host.
  if (req) {
    try {
      const originUrl = new URL(origin);
      const reqOrigin = new URL(req.url).origin;
      if (origin === reqOrigin) return true;

      const publicBase = Deno.env.get("PUBLIC_BASE_URL");
      if (publicBase) {
        try {
          if (origin === new URL(publicBase).origin) return true;
        } catch {
          // ignore malformed PUBLIC_BASE_URL
        }
      }

      const host = req.headers.get("host")?.trim().toLowerCase();
      if (host && originUrl.host.toLowerCase() === host) return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function buildCorsHeaders(origin: string | null, req?: Request): Record<string, string> {
  const allowOrigin = RAW_ALLOWED_ORIGINS.includes("*")
    ? "*"
    : (origin && isOriginAllowed(origin, req) ? origin : "");

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
