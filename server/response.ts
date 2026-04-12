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
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    method: req.method,
    path: url.pathname,
    status,
    durationMs: Math.round(durationMs),
    ip: getClientIp(req),
    ...extra,
  }));
}

export function generateTraceId(): string {
  return crypto.randomUUID();
}
