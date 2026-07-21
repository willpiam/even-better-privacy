import { assertEquals } from "jsr:@std/assert@^1.0.6";

Deno.test("isOriginAllowed permits same-origin Host match used by verify-email page", async () => {
  Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:8787");
  Deno.env.set("PUBLIC_BASE_URL", "https://ebp-cqyo.onrender.com");

  const { isOriginAllowed } = await import(`../cors.ts?cache=${crypto.randomUUID()}`);

  const req = new Request("http://0.0.0.0:10000/api/v1/verify-email", {
    method: "POST",
    headers: {
      host: "ebp-cqyo.onrender.com",
      origin: "https://ebp-cqyo.onrender.com",
    },
  });

  assertEquals(isOriginAllowed("https://ebp-cqyo.onrender.com", req), true);
  assertEquals(isOriginAllowed("https://evil.example", req), false);
  assertEquals(isOriginAllowed("http://127.0.0.1:8787", req), true);
});

Deno.test("isOriginAllowed permits Origin matching PUBLIC_BASE_URL", async () => {
  Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:8787");
  Deno.env.set("PUBLIC_BASE_URL", "https://ebp.example.com");

  const { isOriginAllowed } = await import(`../cors.ts?cache=${crypto.randomUUID()}`);

  const req = new Request("http://127.0.0.1:8080/api/v1/verify-email", {
    method: "POST",
    headers: { origin: "https://ebp.example.com" },
  });

  assertEquals(isOriginAllowed("https://ebp.example.com", req), true);
});

Deno.test("isOriginAllowed permits Origin matching request URL origin", async () => {
  Deno.env.set("ALLOWED_ORIGINS", "http://127.0.0.1:8787");
  Deno.env.delete("PUBLIC_BASE_URL");

  const { isOriginAllowed } = await import(`../cors.ts?cache=${crypto.randomUUID()}`);

  const req = new Request("http://localhost:8080/api/v1/verify-email", {
    method: "POST",
    headers: { origin: "http://localhost:8080" },
  });

  assertEquals(isOriginAllowed("http://localhost:8080", req), true);
});
