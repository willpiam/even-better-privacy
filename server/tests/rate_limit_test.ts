import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import {
  checkRateLimit,
  RATE_LIMIT_CLEANUP,
  RATE_LIMITS,
  rateLimitStore,
} from "../rate-limit.ts";

Deno.unrefTimer(RATE_LIMIT_CLEANUP);

Deno.test("POST verification and hierarchy routes enforce limits and reset after the window", () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (
      const path of [
        "/api/v1/verify-signature",
        "/api/v1/verify-email",
        "/api/v1/hierarchy",
        "/api/v1/hierarchy/propose",
        "/api/v1/hierarchy/accept",
        "/api/v1/hierarchy/reject",
      ]
    ) {
      rateLimitStore.clear();
      const limit = RATE_LIMITS[`POST ${path}`];
      assert(limit);
      for (let i = 0; i < limit.maxRequests; i++) {
        assertEquals(checkRateLimit("test-client", "POST", path), null);
      }
      assert(
        checkRateLimit("test-client", "POST", path)?.includes(
          "rate limit exceeded",
        ),
      );
      assertEquals(checkRateLimit("other-client", "POST", path), null);
      now += limit.windowMs + 1;
      assertEquals(checkRateLimit("test-client", "POST", path), null);
    }
  } finally {
    Date.now = realNow;
    rateLimitStore.clear();
  }
});

Deno.test("unlisted POST routes share a bounded fallback while registration keeps its stricter limit", () => {
  rateLimitStore.clear();
  try {
    for (let i = 0; i < RATE_LIMITS["POST *"].maxRequests; i++) {
      assertEquals(
        checkRateLimit("test-client", "POST", `/api/v1/future-${i}`),
        null,
      );
    }
    assert(
      checkRateLimit("test-client", "POST", "/api/v1/another-future-route"),
    );
    for (let i = 0; i < 10; i++) {
      assertEquals(
        checkRateLimit("test-client", "POST", "/api/v1/identity"),
        null,
      );
    }
    assert(checkRateLimit("test-client", "POST", "/api/v1/identity"));
  } finally {
    rateLimitStore.clear();
  }
});
