# EBP Server Security Report

**Date:** January 13, 2026  
**Scope:** Server security posture assessment and go-live readiness

---

## Executive Summary

The EBP server implements strong **cryptographic foundations** using post-quantum algorithms with proper signature verification for all write operations. However, several **operational security controls** are missing that should be addressed before production deployment. The server is suitable for reference/development use but requires hardening for production go-live.

---

## Current Security Posture

### ✅ Strengths

#### 1. Post-Quantum Cryptography
The server exclusively uses quantum-resistant algorithms:
- **Signing:** ML-DSA (Dilithium) and SLH-DSA (SPHINCS+)
- **Encryption:** ML-KEM (Kyber)
- All signatures are verified server-side before accepting data

#### 2. Signature-Based Authorization
All write operations require cryptographic proof of ownership:
- **Identity registration:** Requires state transition signature
- **Detail attachments:** Requires signed proof with matching path/detail
- **Revocations:** Requires signed certificate from the identity owner

```typescript
// server/main.ts - Example: identity registration requires signature verification
if (signingKeyType === "dilithium") {
  verified = DilithiumSigningKey.verify(variant, transitionMessage, stateSignature, signingKey);
} else {
  verified = SphincsSigningKey.verify(variant, transitionMessage, stateSignature, signingKey);
}
```

#### 3. Replay Attack Protection
Nonce-based protection is implemented for:
- Detail proofs (monotonically increasing nonces per identity)
- Revocation certificates (nonce must exceed previous revocations)
- Emergency revocations use reserved nonce 0 (one-time use)

```typescript
// server/db.ts:161-187 - Nonce validation
if (nonce <= maxNonce) {
  return { ok: false, error: "nonce must be increasing" };
}
```

#### 4. SQL Injection Prevention
All database queries use parameterized statements:

```typescript
// server/db.ts - Parameterized queries throughout
db.query(
  `INSERT INTO identities (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  [record.fingerprint, record.signingKeyType, ...]
);
```

#### 5. Revocation System
Comprehensive revocation support including:
- Detail-level revocation (remove specific data)
- Identity-level revocation (mark entire identity compromised)
- Emergency revocation certificates (pre-generated for key compromise scenarios)
- Revocation status exposed in API responses

#### 6. State Transition Verification
Identity updates require proving knowledge of current state, preventing race conditions and unauthorized modifications:

```typescript
// server/main.ts:192-200
const expectedFromState = currentState ? computeStateHash(currentState) : null;
if (expectedFromState !== fromState) {
  return json({ error: "fromState mismatch" }, 400);
}
```

---

## ⚠️ Security Gaps & Limitations

### HIGH Priority

#### 1. ~~No Rate Limiting~~ ✅ FIXED (Jan 13, 2026)
**Risk:** Denial of service, brute force attacks, resource exhaustion

**Status:** ✅ **IMPLEMENTED** - Per-IP rate limiting with endpoint-specific limits:
- `POST /api/v1/identity`: 10 requests/minute
- `POST /api/v1/detail`: 30 requests/minute
- `POST /api/v1/revoke`: 10 requests/minute
- `GET *`: 200 requests/minute

Returns HTTP 429 with retry-after information when limit exceeded.

#### 2. ~~No Request Body Size Limits~~ ✅ FIXED (Jan 13, 2026)
**Risk:** Memory exhaustion, denial of service

**Status:** ✅ **IMPLEMENTED** - All POST requests limited to 512KB max body size.
- Checks Content-Length header first (fast rejection)
- Streaming body reader with size enforcement
- Returns HTTP 413 for oversized payloads

#### 3. ~~No Input Field Length Validation~~ ✅ FIXED (Jan 13, 2026)
**Risk:** Storage exhaustion, performance degradation

**Status:** ✅ **IMPLEMENTED** - All string fields validated with limits:
```typescript
const LIMITS = {
  fingerprint: 128,      // SHA-256 hex + margin
  path: 256,             // Detail path
  detail: 8192,          // Detail value (8KB)
  proof: 100_000,        // Proof/certificate (post-quantum signatures are large)
  certificate: 100_000,  // Revocation certificate
  reason: 1024,          // Revocation reason
  signingKey: 50_000,    // Post-quantum keys
  encryptionKey: 50_000,
  stateSignature: 50_000,
  stateHash: 128,        // SHA-256 hex
  searchQuery: 256,      // Search query string
};
```

### MEDIUM Priority

#### 4. ~~Wide-Open CORS Policy~~ ✅ FIXED (Jan 13, 2026)
**Status:** ✅ **IMPLEMENTED** - ALLOWED_ORIGINS env allowlist with per-request enforcement.
- Blocks disallowed origins with HTTP 403
- Reflects allowed origin or `*` when wildcard configured

#### 5. ~~No Request Logging/Auditing~~ ✅ FIXED (Jan 13, 2026)
**Status:** ✅ **IMPLEMENTED** - Structured JSON request logging (method, path, status, duration, ip).

#### 6. No TLS Enforcement
**Risk:** Man-in-the-middle attacks

**Current state:** Server listens on HTTP, assumes TLS termination at reverse proxy.

**Impact:**
- Public keys and signatures transmitted in clear text if misconfigured
- Reliance on proper proxy configuration

**Recommendation:**
- Document TLS requirements clearly
- Consider adding `Strict-Transport-Security` header
- Optionally support direct TLS with Deno's built-in TLS

#### 7. No Health Check Authentication
**Risk:** Information disclosure

**Current state:** `/api/v1/health` exposes protocol version publicly.

**Impact:** Minor information leakage about server version.

**Recommendation:** Consider if version disclosure is acceptable; if not, require auth for health endpoint or reduce information.

### LOW Priority

#### 8. No Pagination Limits Enforcement
**Risk:** Resource exhaustion on list operations

**Current state:** Pagination limit capped at 100 per page, which is reasonable.

```typescript
const limit = Math.max(1, Math.min(100, parseInt(...)));
```

**Status:** Adequately implemented. No action required.

#### 9. Error Message Information Disclosure
**Risk:** Minor information leakage through error messages

**Current state:** Error messages are descriptive but reasonable:
```typescript
return json({ error: "identity not found" }, 404);
return json({ error: "invalid signature" }, 400);
```

**Status:** Acceptable for debugging; consider generic errors in production if sensitive.

---

## Test Coverage Assessment

### Current Test Coverage

| Area | Status | Files |
|------|--------|-------|
| Detail proof verification | ✅ Good | `detail_test.ts` |
| Revocation verification | ✅ Good | `revocation_test.ts` |
| Database operations | ✅ Good | `db_test.ts` |
| State building | ✅ Good | `state_test.ts` |
| Crypto helpers | ✅ Good | `crypto_test.ts` |
| Search functionality | ✅ Good | `search_test.ts` |

### Missing Test Coverage

- **Integration tests:** Full API endpoint testing (POST → GET → verify)
- **Negative security tests:** Malformed inputs, oversized payloads
- **Concurrency tests:** Race conditions on nonce validation
- **Performance tests:** Behavior under load

---

## Go-Live Checklist

### Must Have (Before Production)

- [x] **Rate limiting** - ✅ Implemented per-IP and per-endpoint rate limits (Jan 13, 2026)
- [x] **Body size limits** - ✅ Cap request payloads at 512KB (Jan 13, 2026)
- [x] **Field length validation** - ✅ All string fields validated with LIMITS (Jan 13, 2026)
- [x] **Request logging** - ✅ Structured JSON logs per request (method/path/status/duration/ip)
- [ ] **TLS configuration** - Document or enforce HTTPS (pending)
- [ ] **Error handling review** - Ensure no stack traces leak to clients

### Should Have (Recommended)

- [ ] **CORS configuration** - Restrict to known origins in production
- [ ] **Health check improvements** - Add database connectivity check
- [ ] **Metrics collection** - Request counts, latencies, error rates
- [ ] **Database backups** - Automated SQLite backup strategy
- [ ] **Deployment documentation** - Production deployment guide

### Nice to Have (Future)

- [ ] **Proof-of-work** - For spam prevention on identity registration
- [ ] **API versioning strategy** - Clear deprecation policy
- [ ] **Federation support** - Cross-server trust (per roadmap)
- [ ] **Web-of-trust calculations** - Trust scoring based on attestations

---

## Recommended Implementation Priority

### Phase 1: Critical Security (1-2 days) ✅ COMPLETED
1. ✅ Add body size limits to all POST handlers (512KB max)
2. ✅ Add field length validation for all string inputs (see LIMITS in main.ts)
3. ✅ Implement basic rate limiting (per-IP, per-endpoint)

### Phase 2: Operational Security (2-3 days)
4. Add structured request logging
5. Configure CORS for production origins
6. Add integration tests for API endpoints
7. Document TLS/deployment requirements

### Phase 3: Resilience (3-5 days)
8. Add metrics/monitoring hooks
9. Implement database health checks
10. Create backup/restore procedures
11. Performance testing under load

---

## Conclusion

The EBP server has a **solid cryptographic foundation** with proper signature verification protecting all write operations. ~~The primary gaps are **operational security controls** (rate limiting, input validation, logging) that are typical for reference implementations but essential for production.~~

**Update (Jan 13, 2026):** Phase 1 security hardening completed. Critical security controls now in place.

**Current Readiness Level:** ✅ Ready for Limited Production (Phase 1 Complete)

**Remaining for General Production (Phase 2):**
- TLS configuration documentation (reverse proxy expectations + HSTS)
- Error handling review (ensure no stack traces leak)

## TLS / Deployment Guidance (draft)
- Terminate TLS at a hardened reverse proxy (e.g., Nginx/Envoy/Caddy) with HSTS enabled.
- Enforce HTTPS end-to-end; prefer redirecting HTTP → HTTPS at the proxy.
- Forward client IP via `x-forwarded-for`; server logs already read this header.
- Restrict `ALLOWED_ORIGINS` to trusted GUI/CLI origins in production.
- Keep the SQLite file on a protected volume; automate backups and rotation.
- Run the server under a dedicated OS user with least privileges.

## Error Handling Policy
- **4xx errors:** Preserve explicit, user-friendly reasons (validation, signature failures, nonce checks, not found).
- **5xx errors:** Return `{ error: "internal error", traceId }`; full stack and context are logged server-side with the same `traceId`.
- **Logging:** Structured JSON logs per request; error logs include `traceId`, method, path, and stack for ops, without exposing details to clients.

---

## Appendix: Security Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (CLI/GUI)                         │
├─────────────────────────────────────────────────────────────────┤
│  • Generates key pairs (Dilithium/SPHINCS+ + Kyber)             │
│  • Signs state transitions, details, revocations                │
│  • Computes fingerprints locally                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS (via proxy)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       EBP Server                                │
├─────────────────────────────────────────────────────────────────┤
│  ✅ Rate Limiting (per-IP, per-endpoint)                        │
│  ✅ Body Size Limits (512KB max)                                │
│  ✅ Field Length Validation (all string inputs)                 │
├─────────────────────────────────────────────────────────────────┤
│  POST /identity   → Verify state signature → Store              │
│  POST /detail     → Verify proof signature → Check nonce → Store│
│  POST /revoke     → Verify cert signature → Check nonce → Apply │
│  GET  /identity/* → Return with revocation status               │
├─────────────────────────────────────────────────────────────────┤
│  ⚠️ TODO: Request logging, TLS documentation                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SQLite Database                            │
├─────────────────────────────────────────────────────────────────┤
│  identities: fingerprint, keys, details, revocation status      │
│  details: path, value, proof, revocation status                 │
│  revocations: type, target, nonce, certificate                  │
└─────────────────────────────────────────────────────────────────┘
```
