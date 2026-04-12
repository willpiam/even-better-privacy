// =============================================================================
// Rate Limiting
// =============================================================================

/** Rate limit configuration per endpoint pattern */
export const RATE_LIMITS: Record<string, { windowMs: number; maxRequests: number }> = {
  "POST /api/v1/identity": { windowMs: 60_000, maxRequests: 10 },
  "POST /api/v1/detail": { windowMs: 60_000, maxRequests: 30 },
  "POST /api/v1/revoke": { windowMs: 60_000, maxRequests: 10 },
  "POST /api/v1/verify-email/request": { windowMs: 60_000, maxRequests: 15 },
  "GET /api/v1/verify-email": { windowMs: 60_000, maxRequests: 30 },
  "POST /api/v1/mail/oauth/exchange": { windowMs: 60_000, maxRequests: 10 },
  "POST /api/v1/mail/oauth/refresh": { windowMs: 60_000, maxRequests: 20 },
  "GET *": { windowMs: 60_000, maxRequests: 200 },
};

/** Disable rate limiting via env for tests or local dev. */
export const RATE_LIMIT_DISABLED =
  (Deno.env.get("RATE_LIMIT_DISABLED") ?? "false").toLowerCase() === "true";

/** In-memory rate limit tracking: IP -> endpoint -> { count, windowStart } */
export const rateLimitStore = new Map<string, Map<string, { count: number; windowStart: number }>>();

/** Clean up old rate limit entries every 5 minutes */
export const RATE_LIMIT_CLEANUP = setInterval(() => {
  const now = Date.now();
  for (const [ip, endpoints] of rateLimitStore) {
    for (const [endpoint, data] of endpoints) {
      if (now - data.windowStart > 300_000) { // 5 minutes
        endpoints.delete(endpoint);
      }
    }
    if (endpoints.size === 0) {
      rateLimitStore.delete(ip);
    }
  }
}, 300_000);

/**
 * Check if a request is rate limited
 * @returns error message if rate limited, null if allowed
 */
export function checkRateLimit(ip: string, method: string, pathname: string): string | null {
  const exactKey = `${method} ${pathname}`;
  const wildcardKey = `${method} *`;
  const config = RATE_LIMITS[exactKey] ?? RATE_LIMITS[wildcardKey];
  
  if (!config) return null;
  
  const endpointKey = RATE_LIMITS[exactKey] ? exactKey : wildcardKey;
  const now = Date.now();
  
  let ipStore = rateLimitStore.get(ip);
  if (!ipStore) {
    ipStore = new Map();
    rateLimitStore.set(ip, ipStore);
  }
  
  let data = ipStore.get(endpointKey);
  if (!data || now - data.windowStart > config.windowMs) {
    data = { count: 1, windowStart: now };
    ipStore.set(endpointKey, data);
    return null;
  }
  
  data.count++;
  if (data.count > config.maxRequests) {
    const retryAfter = Math.ceil((config.windowMs - (now - data.windowStart)) / 1000);
    return `rate limit exceeded, retry after ${retryAfter}s`;
  }
  
  return null;
}

/**
 * Get client IP from request headers (handles proxies)
 */
export function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    ?? req.headers.get("x-real-ip") 
    ?? "unknown";
}
