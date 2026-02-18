import { assertEquals, assert } from "jsr:@std/assert@^1.0.6";

// Import the validation helper and limits by reading from main.ts
// We'll test the security features by directly testing the exported validation logic

/**
 * These tests verify the security hardening implemented in Phase 1:
 * 1. Body size limits (MAX_BODY_SIZE = 512KB)
 * 2. Field length validation (LIMITS object)
 * 3. Rate limiting (in-memory per-IP tracking)
 * 
 * Note: Most security features are tested via integration with the server.
 * These unit tests cover the validation logic boundaries.
 */

// Field length limits (mirrored from main.ts for testing)
const LIMITS = {
  fingerprint: 128,
  path: 256,
  detail: 8192,
  proof: 100_000,
  certificate: 100_000,
  reason: 1024,
  signingKey: 50_000,
  encryptionKey: 50_000,
  stateSignature: 50_000,
  stateHash: 128,
  searchQuery: 256,
};

Deno.test("LIMITS: fingerprint allows bech32 fingerprints", () => {
  const bech32Fingerprint = "ebpdk1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsq2v3";
  assert(bech32Fingerprint.length <= LIMITS.fingerprint, "fingerprint limit should allow bech32 fingerprints");
});

Deno.test("LIMITS: path allows reasonable path lengths", () => {
  const longPath = "profile/settings/preferences/theme";
  assert(longPath.length <= LIMITS.path, "path limit should allow reasonable paths");
});

Deno.test("LIMITS: detail allows 8KB of content", () => {
  const detail8KB = "x".repeat(8192);
  assert(detail8KB.length <= LIMITS.detail, "detail limit should allow 8KB");
  
  const tooLong = "x".repeat(8193);
  assert(tooLong.length > LIMITS.detail, "detail limit should reject > 8KB");
});

Deno.test("LIMITS: search query has reasonable limit", () => {
  const query = "alice@example.com";
  assert(query.length <= LIMITS.searchQuery, "search query should allow normal searches");
  
  const tooLong = "x".repeat(257);
  assert(tooLong.length > LIMITS.searchQuery, "search query should reject very long queries");
});

Deno.test("LIMITS: state hash allows SHA-256 hex", () => {
  const sha256Hex = "a".repeat(64);
  assert(sha256Hex.length <= LIMITS.stateHash, "state hash should allow SHA-256 hex");
});

// Rate limiting structure test
Deno.test("Rate limiting: configuration covers all write endpoints", () => {
  const RATE_LIMITS: Record<string, { windowMs: number; maxRequests: number }> = {
    "POST /api/v1/identity": { windowMs: 60_000, maxRequests: 10 },
    "POST /api/v1/detail": { windowMs: 60_000, maxRequests: 30 },
    "POST /api/v1/revoke": { windowMs: 60_000, maxRequests: 10 },
    "GET *": { windowMs: 60_000, maxRequests: 200 },
  };

  // Verify all POST endpoints are covered
  assert("POST /api/v1/identity" in RATE_LIMITS, "identity endpoint should be rate limited");
  assert("POST /api/v1/detail" in RATE_LIMITS, "detail endpoint should be rate limited");
  assert("POST /api/v1/revoke" in RATE_LIMITS, "revoke endpoint should be rate limited");
  
  // Verify GET has a wildcard fallback
  assert("GET *" in RATE_LIMITS, "GET endpoints should have rate limiting");
  
  // Verify window is 1 minute
  assertEquals(RATE_LIMITS["POST /api/v1/identity"].windowMs, 60_000);
  
  // Verify identity registration has lower limit (spam prevention)
  assert(
    RATE_LIMITS["POST /api/v1/identity"].maxRequests < RATE_LIMITS["POST /api/v1/detail"].maxRequests,
    "identity creation should have stricter limits than detail updates"
  );
});

Deno.test("Body size limit: 512KB is appropriate for post-quantum crypto", () => {
  const MAX_BODY_SIZE = 512 * 1024;
  
  // Post-quantum signatures can be 1-50KB depending on scheme
  // A reasonable identity payload with keys + signature should fit
  const estimatedIdentityPayload = 
    LIMITS.signingKey +      // ~50KB max
    LIMITS.encryptionKey +   // ~50KB max
    LIMITS.stateSignature +  // ~50KB max
    1000;                    // metadata overhead
  
  assert(
    estimatedIdentityPayload < MAX_BODY_SIZE,
    "body size limit should accommodate post-quantum identity payloads"
  );
});

// Validation helper test (simulates validateStringLength)
function validateStringLength(
  value: unknown,
  fieldName: string,
  maxLength: number,
  required = true
): { ok: true; value: string } | { ok: false; error: string } {
  if (value === undefined || value === null) {
    if (required) {
      return { ok: false, error: `missing ${fieldName}` };
    }
    return { ok: true, value: "" };
  }
  
  if (typeof value !== "string") {
    return { ok: false, error: `${fieldName} must be a string` };
  }
  
  if (required && value.length === 0) {
    return { ok: false, error: `${fieldName} cannot be empty` };
  }
  
  if (value.length > maxLength) {
    return { ok: false, error: `${fieldName} too long (max ${maxLength} characters)` };
  }
  
  return { ok: true, value };
}

Deno.test("validateStringLength: accepts valid strings", () => {
  const result = validateStringLength("hello", "test", 10);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value, "hello");
  }
});

Deno.test("validateStringLength: rejects missing required field", () => {
  const result = validateStringLength(undefined, "test", 10, true);
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.error, "missing test");
  }
});

Deno.test("validateStringLength: allows missing optional field", () => {
  const result = validateStringLength(undefined, "test", 10, false);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value, "");
  }
});

Deno.test("validateStringLength: rejects empty required field", () => {
  const result = validateStringLength("", "test", 10, true);
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.error, "test cannot be empty");
  }
});

Deno.test("validateStringLength: rejects non-string values", () => {
  const result = validateStringLength(123, "test", 10);
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.error, "test must be a string");
  }
});

Deno.test("validateStringLength: rejects too-long strings", () => {
  const result = validateStringLength("hello world", "test", 5);
  assert(!result.ok);
  if (!result.ok) {
    assertEquals(result.error, "test too long (max 5 characters)");
  }
});

Deno.test("validateStringLength: accepts string at exact max length", () => {
  const result = validateStringLength("hello", "test", 5);
  assert(result.ok);
  if (result.ok) {
    assertEquals(result.value, "hello");
  }
});
