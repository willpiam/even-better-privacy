import { assertEquals } from "jsr:@std/assert@^1.0.6";

Deno.test("health endpoint allows configured origin and blocks others", async () => {
  // Configure allowed origin before loading the server
  Deno.env.set("ALLOWED_ORIGINS", "http://allowed.test");
  Deno.env.set("HSTS_ENABLED", "true");
  Deno.env.set("HSTS_MAX_AGE", "86400");

  const { startServer, closeDb } = await import("../main.ts");

  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  const controller = new AbortController();
  const port = 9800 + Math.floor(Math.random() * 100);

  const serverPromise = startServer({ port, dbPath, signal: controller.signal });

  // Give server a moment to start
  await new Promise((r) => setTimeout(r, 50));

  // Allowed origin should succeed and reflect origin
  const okRes = await fetch(`http://localhost:${port}/api/v1/health`, {
    headers: { origin: "http://allowed.test" },
  });
  assertEquals(okRes.status, 200);
  assertEquals(okRes.headers.get("access-control-allow-origin"), "http://allowed.test");
  assertEquals(okRes.headers.get("strict-transport-security"), "max-age=86400");
  await okRes.text(); // consume body

  // Disallowed origin should be rejected
  const badRes = await fetch(`http://localhost:${port}/api/v1/health`, {
    headers: { origin: "http://blocked.test" },
  });
  assertEquals(badRes.status, 403);
  await badRes.text(); // consume body

  controller.abort();
  await serverPromise;
  await closeDb();
});
