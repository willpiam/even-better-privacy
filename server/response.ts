import { buildSecurityHeaders } from "./cors.ts";
import { getClientIp } from "./rate-limit.ts";

export function json(body: unknown, status = 200, corsHeaders?: HeadersInit): Response {
  const securityHeaders = buildSecurityHeaders();
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      ...securityHeaders,
      ...corsHeaders,
    },
  });
}

export function attachCors(res: Response, corsHeaders: HeadersInit): Response {
  const headers = new Headers(res.headers);
  const securityHeaders = buildSecurityHeaders();
  for (const [k, v] of Object.entries(securityHeaders)) {
    headers.set(k, v);
  }
  for (const [k, v] of Object.entries(corsHeaders as Record<string, string>)) {
    headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, headers });
}

export function logRequest(req: Request, status: number, durationMs: number, extra?: Record<string, unknown>): void {
  const url = new URL(req.url);
  // F-SERVER-03: prefer the caller-supplied `clientIp` (which was resolved
  // from ConnInfo in the main handler). Fall back to the header-based
  // derivation only if no caller supplied one — which now returns the
  // socket peer when TRUST_PROXY is off and "unknown" in test contexts.
  const ip = typeof extra?.clientIp === "string" ? extra.clientIp : getClientIp(req);
  const rest = { ...extra };
  delete (rest as Record<string, unknown>).clientIp;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    method: req.method,
    path: url.pathname,
    status,
    durationMs: Math.round(durationMs),
    ip,
    ...rest,
  }));
}

export function generateTraceId(): string {
  return crypto.randomUUID();
}

// Escape a string for safe interpolation into HTML content or attribute
// values. Escapes the five conventional characters (F-SERVER-01).
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
