import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { handleRequest } from "../routes.ts";
import { initSecurity, setCsrfTokenForTest } from "../security.ts";

const TEST_TOKEN = "t".repeat(64);

async function withSecurity(fn: () => Promise<void>): Promise<void> {
	const home = await Deno.makeTempDir({ prefix: "ebp-csrf-test-" });
	try {
		await initSecurity({ home, persist: false });
		setCsrfTokenForTest(TEST_TOKEN);
		await fn();
	} finally {
		await Deno.remove(home, { recursive: true });
	}
}

function req(
	method: string,
	path: string,
	headers: Record<string, string> = {},
	body?: string,
): Request {
	const fullHeaders: Record<string, string> = {
		host: "127.0.0.1:8787",
		...headers,
	};
	return new Request(`http://127.0.0.1:8787${path}`, {
		method,
		headers: fullHeaders,
		body,
	});
}

Deno.test({
	name: "F-GUI-01: mutating request without csrf header returns 403",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"POST",
				"/api/v1/identity/generate",
				{ "content-type": "application/json" },
				JSON.stringify({ name: "x", password: "password12345" }),
			));
			assertEquals(res.status, 403);
		});
	},
});

Deno.test({
	name: "F-GUI-01: mutating request with bad csrf header returns 403",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"POST",
				"/api/v1/identity/generate",
				{ "content-type": "application/json", "x-ebp-csrf": "nope" },
				JSON.stringify({ name: "x", password: "password12345" }),
			));
			assertEquals(res.status, 403);
		});
	},
});

Deno.test({
	name: "F-GUI-01: bad host header is rejected",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"GET",
				"/api/v1/health",
				{ host: "evil.example.com" },
			));
			assertEquals(res.status, 403);
		});
	},
});

Deno.test({
	name: "F-GUI-01: preflight from disallowed origin returns 403",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"OPTIONS",
				"/api/v1/identity/generate",
				{ origin: "https://evil.example.com" },
			));
			assertEquals(res.status, 403);
		});
	},
});

Deno.test({
	name: "F-GUI-01: request from disallowed origin is rejected",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"GET",
				"/api/v1/health",
				{ origin: "https://evil.example.com" },
			));
			assertEquals(res.status, 403);
		});
	},
});

Deno.test({
	name: "F-GUI-01: health endpoint accessible without csrf",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req("GET", "/api/v1/health"));
			assertEquals(res.status, 200);
		});
	},
});

Deno.test({
	name: "F-GUI-01: csrf-token endpoint returns token to allowed origin",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"GET",
				"/api/v1/csrf-token",
				{ origin: "tauri://localhost" },
			));
			assertEquals(res.status, 200);
			const body = await res.json();
			assertEquals(body.token, TEST_TOKEN);
			assertEquals(res.headers.get("access-control-allow-origin"), "tauri://localhost");
		});
	},
});

Deno.test({
	name: "F-GUI-01: mutating request with correct csrf token passes security",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const home = await Deno.makeTempDir({ prefix: "ebp-csrf-pass-" });
			try {
				const res = await handleRequest(req(
					"POST",
					"/api/v1/identity/generate",
					{
						"content-type": "application/json",
						"x-ebp-csrf": TEST_TOKEN,
						"origin": "tauri://localhost",
					},
					JSON.stringify({
						name: "csrftest",
						password: "password12345",
						signingType: "dilithium",
						encryptionType: "kyber",
						home,
					}),
				));
				// Either 201 (created) or an application error code, but
				// NOT 403 from security layer.
				if (res.status === 403) {
					throw new Error(`expected non-403 status, got 403 body=${await res.text()}`);
				}
			} finally {
				await Deno.remove(home, { recursive: true });
			}
		});
	},
});

Deno.test({
	name: "F-GUI-01: OPTIONS preflight from allowed origin includes csrf in allow-headers",
	permissions: { read: true, write: true, env: true, net: true },
	fn: async () => {
		await withSecurity(async () => {
			const res = await handleRequest(req(
				"OPTIONS",
				"/api/v1/identity/generate",
				{ origin: "tauri://localhost" },
			));
			assertEquals(res.status, 204);
			const allowHeaders = res.headers.get("access-control-allow-headers") ?? "";
			if (!allowHeaders.toLowerCase().includes("x-ebp-csrf")) {
				throw new Error(`expected x-ebp-csrf in allow-headers, got: ${allowHeaders}`);
			}
		});
	},
});
