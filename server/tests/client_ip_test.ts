import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { getClientIp } from "../rate-limit.ts";

// F-SERVER-03: by default the server trusts only the socket peer address.
// `X-Forwarded-For` / `X-Real-IP` must be honoured only when TRUST_PROXY
// is set. These tests pass explicit `remoteAddr` values rather than
// relying on environment state.

function req(headers: Record<string, string> = {}): Request {
	return new Request("http://example.test/api/v1/identity", { method: "GET", headers });
}

// The TRUST_PROXY env is read at module load; we can't flip it between
// tests reliably. Instead we exercise the off-path (default) here, which
// is the production-safe default, and validate that XFF does not leak.

Deno.test("F-SERVER-03: by default XFF header is ignored", () => {
	const r = req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8" });
	const ip = getClientIp(r, { hostname: "10.0.0.1" });
	assertEquals(ip, "10.0.0.1");
});

Deno.test("F-SERVER-03: default getClientIp returns 'unknown' when no remoteAddr", () => {
	const r = req({ "x-forwarded-for": "1.2.3.4" });
	const ip = getClientIp(r, undefined);
	assertEquals(ip, "unknown");
});

Deno.test("F-SERVER-03: default getClientIp ignores spoofed XFF even without remoteAddr", () => {
	const r = req({ "x-forwarded-for": "9.9.9.9" });
	// Intentionally do not pass remoteAddr — simulating a bogus proxy/test.
	// The attacker-supplied header must NOT become the bucket key.
	const ip = getClientIp(r);
	assertEquals(ip, "unknown");
});
