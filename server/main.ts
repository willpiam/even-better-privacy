#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { DilithiumSigningKey } from "../core/Dilithium.ts";
import { SphincsSigningKey } from "../core/Sphincs.ts";
import { PROTOCOL_VERSION } from "../core/version.ts";
import {
  ensureNewNonce,
  getDetailByVerificationToken,
  getDetailRecord,
  getDetailsMap,
  getDetailsMetaMap,
  getIdentity,
  getMaxRevocationNonce,
  getRevocations,
  getRevokedDetailPaths,
  hasRevocationWithNonce,
  initDb,
  insertDetail,
  insertIdentity,
  insertRevocation,
  isDetailRevoked,
  isIdentityRevoked,
  revokeDetail,
  revokeIdentity,
  updateDetail,
  updateDetailVerification,
} from "./db.ts";
import type { DatabaseAdapter } from "./db.ts";
import {
  computeIdentityFingerprint,
  computeSigningRawFingerprint,
  computeStateHash,
  computeTokenHash,
  stableStringify,
  toHex,
} from "./crypto.ts";
import nodemailer from "npm:nodemailer";
import { verifyDetailProof } from "./detail.ts";
import { verifyRevocationCertificate } from "./revocation.ts";
import { buildState } from "./state.ts";
import type { DetailPayload, RevocationPayload } from "./types.ts";

// =============================================================================
// CORS Configuration
// =============================================================================

const RAW_ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "*")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// =============================================================================
// HSTS Configuration (optional; enabled via env)
// =============================================================================

const HSTS_ENABLED = (Deno.env.get("HSTS_ENABLED") ?? "false").toLowerCase() === "true";
const HSTS_MAX_AGE = Number(Deno.env.get("HSTS_MAX_AGE") ?? "31536000"); // 1 year
const HSTS_INCLUDE_SUBDOMAINS = (Deno.env.get("HSTS_INCLUDE_SUBDOMAINS") ?? "false").toLowerCase() === "true";

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // non-browser or same-origin
  if (RAW_ALLOWED_ORIGINS.includes("*")) return true;
  return RAW_ALLOWED_ORIGINS.some((o) => o === origin);
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowOrigin = RAW_ALLOWED_ORIGINS.includes("*")
    ? "*"
    : (origin && isOriginAllowed(origin) ? origin : "");

  const headers: Record<string, string> = {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };

  if (allowOrigin) {
    headers["access-control-allow-origin"] = allowOrigin;
  }

  return headers;
}

function buildSecurityHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (HSTS_ENABLED) {
    headers["strict-transport-security"] = `max-age=${HSTS_MAX_AGE}` +
      (HSTS_INCLUDE_SUBDOMAINS ? "; includeSubDomains" : "");
  }
  return headers;
}

// =============================================================================
// Security Limits
// =============================================================================

/** Maximum request body size in bytes (512KB) */
const MAX_BODY_SIZE = 512 * 1024;

/** Field length limits */
const LIMITS = {
  fingerprint: 128,         // SHA-256 hex = 64 chars, allow some margin
  path: 256,                // Detail path
  detail: 8192,             // Detail value (8KB)
  proof: 100_000,           // Proof/certificate can be large due to signatures
  certificate: 100_000,     // Revocation certificate
  reason: 1024,             // Revocation reason
  signingKey: 50_000,       // Post-quantum keys are large
  encryptionKey: 50_000,
  stateSignature: 50_000,
  stateHash: 128,           // SHA-256 hex
  searchQuery: 256,         // Search query string
  verificationToken: 256,   // Email verification token
};

// =============================================================================
// Email Verification Configuration
// =============================================================================

const EMAIL_VERIFICATION_TTL_MS =
  Number(Deno.env.get("EMAIL_VERIFICATION_TTL_MS") ?? String(24 * 60 * 60 * 1000));

const EMAIL_VERIFICATION_STORE_PLAINTEXT =
  (Deno.env.get("EMAIL_VERIFICATION_STORE_PLAINTEXT") ?? "false").toLowerCase() === "true";

function generateVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function isLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  return hostname.endsWith(".localhost");
}

function getPublicBaseUrl(req: Request): string | null {
  const configured = Deno.env.get("PUBLIC_BASE_URL");
  if (configured) return configured;

  const url = new URL(req.url);
  if (isLocalHostname(url.hostname)) return url.origin;

  return null;
}

async function sendVerificationEmail(to: string, link: string, fingerprint: string): Promise<void> {
  const host = Deno.env.get("SMTP_HOST");
  const from = Deno.env.get("SMTP_FROM");
  if (!host || !from) {
    console.log(`[email-verification] ${to}: ${link} (fingerprint: ${fingerprint})`);
    return;
  }

  const port = Number(Deno.env.get("SMTP_PORT") ?? "587");
  const secure =
    (Deno.env.get("SMTP_SECURE") ?? "").toLowerCase() === "true" ||
    port === 465;
  const user = Deno.env.get("SMTP_USER") ?? undefined;
  const pass = Deno.env.get("SMTP_PASS") ?? undefined;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: pass ?? "" } : undefined,
  });

  await transport.sendMail({
    from,
    to,
    subject: "Verify your email",
    text:
      `Please verify your email by visiting this link:\n\n${link}\n\n` +
      `Identity fingerprint:\n${fingerprint}\n\n` +
      `If you did not request this, you can ignore this message.`,
  });
}

// =============================================================================
// Rate Limiting
// =============================================================================

/** Rate limit configuration per endpoint pattern */
const RATE_LIMITS: Record<string, { windowMs: number; maxRequests: number }> = {
  "POST /api/v1/identity": { windowMs: 60_000, maxRequests: 10 },
  "POST /api/v1/detail": { windowMs: 60_000, maxRequests: 30 },
  "POST /api/v1/revoke": { windowMs: 60_000, maxRequests: 10 },
  "POST /api/v1/verify-email/request": { windowMs: 60_000, maxRequests: 15 },
  "GET /api/v1/verify-email": { windowMs: 60_000, maxRequests: 30 },
  "GET *": { windowMs: 60_000, maxRequests: 200 },
};

/** Disable rate limiting via env for tests or local dev. */
const RATE_LIMIT_DISABLED =
  (Deno.env.get("RATE_LIMIT_DISABLED") ?? "false").toLowerCase() === "true";

/** In-memory rate limit tracking: IP -> endpoint -> { count, windowStart } */
const rateLimitStore = new Map<string, Map<string, { count: number; windowStart: number }>>();

/** Clean up old rate limit entries every 5 minutes */
const RATE_LIMIT_CLEANUP = setInterval(() => {
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
function checkRateLimit(ip: string, method: string, pathname: string): string | null {
  // Find matching rate limit config
  const exactKey = `${method} ${pathname}`;
  const wildcardKey = `${method} *`;
  const config = RATE_LIMITS[exactKey] ?? RATE_LIMITS[wildcardKey];
  
  if (!config) return null; // No rate limit configured
  
  const endpointKey = RATE_LIMITS[exactKey] ? exactKey : wildcardKey;
  const now = Date.now();
  
  let ipStore = rateLimitStore.get(ip);
  if (!ipStore) {
    ipStore = new Map();
    rateLimitStore.set(ip, ipStore);
  }
  
  let data = ipStore.get(endpointKey);
  if (!data || now - data.windowStart > config.windowMs) {
    // Start new window
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
function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() 
    ?? req.headers.get("x-real-ip") 
    ?? "unknown";
}

// =============================================================================
// Body Parsing with Size Limit
// =============================================================================

/**
 * Safely read and parse JSON body with size limit
 */
async function readJsonBody<T>(req: Request): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  // Check content-length header first
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_SIZE) {
    return { ok: false, error: `payload too large (max ${MAX_BODY_SIZE} bytes)`, status: 413 };
  }
  
  try {
    // Read body with size limit
    const reader = req.body?.getReader();
    if (!reader) {
      return { ok: false, error: "missing request body", status: 400 };
    }
    
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      totalSize += value.length;
      if (totalSize > MAX_BODY_SIZE) {
        reader.cancel();
        return { ok: false, error: `payload too large (max ${MAX_BODY_SIZE} bytes)`, status: 413 };
      }
      chunks.push(value);
    }
    
    // Combine chunks and parse JSON
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    
    const text = new TextDecoder().decode(combined);
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch (e) {
    if (e instanceof SyntaxError) {
      return { ok: false, error: "invalid json", status: 400 };
    }
    return { ok: false, error: "failed to read request body", status: 400 };
  }
}

// =============================================================================
// Field Validation
// =============================================================================

/**
 * Validate string field length
 */
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

// =============================================================================
// Configuration
// =============================================================================

const PORT = Number(Deno.env.get("PORT") ?? "8080");
const DB_PATH = Deno.env.get("DB_PATH") ?? "./ebp.sqlite";

let db: DatabaseAdapter | null = null;
let currentDbPath = DB_PATH;

async function getDb(): Promise<DatabaseAdapter> {
  if (!db) {
    db = await initDb(currentDbPath);
  }
  return db;
}

async function replaceDb(dbPath: string): Promise<void> {
  try {
    if (db) {
      await db.close();
    }
  } catch {
    // ignore close errors
  }
  currentDbPath = dbPath;
  db = await initDb(dbPath);
}

async function closeDb(): Promise<void> {
  try {
    if (db) {
      await db.close();
    }
  } catch {
    // ignore close errors
  }
  try {
    clearInterval(RATE_LIMIT_CLEANUP);
  } catch {
    // ignore
  }
}

addEventListener("unload", () => {
  clearInterval(RATE_LIMIT_CLEANUP);
  void closeDb();
});

/**
 * Start the HTTP server. Used in main runtime and integration tests.
 */
export async function startServer(options: {
  port?: number;
  dbPath?: string;
  signal?: AbortSignal;
} = {}): Promise<void> {
  const port = options.port ?? PORT;
  const dbPath = options.dbPath ?? DB_PATH;

  // Reinitialize DB if a different path is provided
  if (!db || dbPath !== currentDbPath) {
    await replaceDb(dbPath);
  }

  console.log(`EBP server listening on http://localhost:${port}`);
  await serve(handleRequest, { port, signal: options.signal });
}

if (import.meta.main) {
  startServer();
}

async function handleRequest(req: Request): Promise<Response> {
  const start = performance.now();
  const url = new URL(req.url);
  const clientIp = getClientIp(req);
  const origin = req.headers.get("origin");
  const corsHeaders = buildCorsHeaders(origin);

  const respond = (response: Response, extra?: Record<string, unknown>): Response => {
    logRequest(req, response.status, performance.now() - start, extra);
    return response;
  };
  const jsonResponse = (body: unknown, status = 200): Response =>
    respond(json(body, status, corsHeaders));

  try {
    // Enforce CORS allowlist for browser-origin requests
    if (origin && !isOriginAllowed(origin)) {
      return jsonResponse({ error: "origin not allowed" }, 403);
    }

    if (req.method === "OPTIONS") {
      return respond(new Response(null, { status: 204, headers: corsHeaders }));
    }

    // Check rate limit (skip for health endpoint or when disabled for tests)
    if (!RATE_LIMIT_DISABLED && url.pathname !== "/api/v1/health") {
      const rateLimitError = checkRateLimit(clientIp, req.method, url.pathname);
      if (rateLimitError) {
        return jsonResponse({ error: rateLimitError }, 429);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      return jsonResponse({ status: "ok", protocolVersion: PROTOCOL_VERSION });
    }

    const db = await getDb();

    if (req.method === "GET" && url.pathname === "/api/v1/identities") {
      return respond(attachCors(await handleListIdentities(url, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname === "/api/v1/identities/search") {
      return respond(attachCors(await handleSearchIdentities(url, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/identity/")) {
      const fingerprint = url.pathname.split("/").pop()!;
      return respond(attachCors(await handleGetIdentity(fingerprint, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/identity") {
      return respond(attachCors(await handlePostIdentity(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/detail") {
      return respond(attachCors(await handlePostDetail(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/verify-email/request") {
      return respond(attachCors(await handleRequestVerifyEmail(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/verify-email") {
      return respond(attachCors(await handleVerifyEmailConfirm(req, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname === "/api/v1/verify-email") {
      return respond(attachCors(await handleVerifyEmailPage(url), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/revoke") {
      return respond(attachCors(await handlePostRevocation(req, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/revocations/")) {
      const fingerprint = url.pathname.split("/").pop()!;
      return respond(attachCors(await handleGetRevocations(fingerprint, db), corsHeaders));
    }

    return jsonResponse({ error: "not found" }, 404);
  } catch (err) {
    const traceId = generateTraceId();
    console.error(JSON.stringify({
      level: "error",
      traceId,
      method: req.method,
      path: url.pathname,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    return respond(json({ error: "internal error", traceId }, 500, corsHeaders), { traceId });
  }
}

function json(body: unknown, status = 200, corsHeaders?: HeadersInit): Response {
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

function attachCors(res: Response, corsHeaders: HeadersInit): Response {
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

function logRequest(req: Request, status: number, durationMs: number, extra?: Record<string, unknown>): void {
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

function generateTraceId(): string {
  return crypto.randomUUID();
}

function coerceNumber(value: number | string | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") return Number(value);
  return Number(value);
}

async function handlePostIdentity(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const signingKeyType = payload.signingKeyType;
  const encryptionKeyType = payload.encryptionKeyType;

  if (signingKeyType !== "dilithium" && signingKeyType !== "sphincs") {
    return json({ error: "unsupported signingKeyType" }, 400);
  }
  if (encryptionKeyType !== "kyber") {
    return json({ error: "unsupported encryptionKeyType" }, 400);
  }

  // Validate field lengths
  const signingKeyCheck = validateStringLength(payload.signingKey, "signingKey", LIMITS.signingKey);
  if (!signingKeyCheck.ok) return json({ error: signingKeyCheck.error }, 400);
  const signingKey = signingKeyCheck.value;

  const encryptionKeyCheck = validateStringLength(payload.encryptionKey, "encryptionKey", LIMITS.encryptionKey);
  if (!encryptionKeyCheck.ok) return json({ error: encryptionKeyCheck.error }, 400);
  const encryptionKey = encryptionKeyCheck.value;

  const toStateCheck = validateStringLength(payload.toState, "toState", LIMITS.stateHash);
  if (!toStateCheck.ok) return json({ error: toStateCheck.error }, 400);
  const toState = toStateCheck.value;

  const stateSignatureCheck = validateStringLength(payload.stateSignature, "stateSignature", LIMITS.stateSignature);
  if (!stateSignatureCheck.ok) return json({ error: stateSignatureCheck.error }, 400);
  const stateSignature = stateSignatureCheck.value;

  const fromStateCheck = validateStringLength(payload.fromState, "fromState", LIMITS.stateHash, false);
  if (!fromStateCheck.ok) return json({ error: fromStateCheck.error }, 400);
  const fromState = fromStateCheck.value || null;

  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint, false);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const providedFingerprint = fingerprintCheck.value || undefined;

  const signingKeyDetails = payload.signingKeyDetails as Record<string, unknown> | undefined;
  const encryptionKeyDetails = payload.encryptionKeyDetails as Record<string, unknown> | undefined;

  try {
    // ensure keys parse
    computeSigningRawFingerprint(signingKeyType, signingKey);
  } catch {
    return json({ error: "invalid signingKey" }, 400);
  }

  let fingerprint: string;
  try {
    fingerprint = computeIdentityFingerprint({
      signingKeyType,
      encryptionKeyType,
      signingKey,
      encryptionKey,
    });
  } catch {
    return json({ error: "failed to compute fingerprint" }, 400);
  }

  if (providedFingerprint && providedFingerprint !== fingerprint) {
    return json({ error: "fingerprint mismatch" }, 400);
  }

  const existing = await getIdentity(db, fingerprint);
  const currentDetails = await getDetailsMap(db, fingerprint);
  const currentState = existing
    ? buildState(existing, currentDetails)
    : undefined;

  if (existing) {
    if (
      existing.signing_key_type !== signingKeyType ||
      existing.encryption_key_type !== encryptionKeyType ||
      existing.signing_key !== signingKey ||
      existing.encryption_key !== encryptionKey
    ) {
      return json({ error: "identity keys differ from existing record" }, 400);
    }
  }

  const targetState = buildState({
    fingerprint,
    signing_key_type: signingKeyType,
    encryption_key_type: encryptionKeyType,
    signing_key: signingKey,
    encryption_key: encryptionKey,
    signing_key_details: signingKeyDetails ?? null,
    encryption_key_details: encryptionKeyDetails ?? null,
    created_at: existing?.created_at ?? Date.now(),
  }, existing ? currentDetails : {});

  const expectedToState = computeStateHash(targetState);
  if (toState !== expectedToState) {
    return json({ error: "toState mismatch" }, 400);
  }

  const expectedFromState = currentState ? computeStateHash(currentState) : null;
  if (expectedFromState !== fromState) {
    return json({ error: "fromState mismatch" }, 400);
  }

  const variant =
    (existing?.signing_key_details as { variant?: string } | null)?.variant ??
    signingKeyDetails?.variant;
  if (!variant || typeof variant !== "string") {
    return json({ error: "missing signing variant" }, 400);
  }

  const transitionMessage = stableStringify({ fromState, toState });
  let verified = false;
  try {
    if (signingKeyType === "dilithium") {
      verified = DilithiumSigningKey.verify(variant, transitionMessage, stateSignature, signingKey);
    } else {
      verified = SphincsSigningKey.verify(variant, transitionMessage, stateSignature, signingKey);
    }
  } catch {
    return json({ error: "failed to verify stateSignature" }, 400);
  }
  if (!verified) {
    return json({ error: "invalid stateSignature" }, 400);
  }

  if (existing) {
    // Identity already present; nothing to update (details handled separately).
    return json({ fingerprint });
  }

  await insertIdentity(db, {
    fingerprint,
    signingKeyType,
    encryptionKeyType,
    signingKey,
    encryptionKey,
    signingKeyDetails: signingKeyDetails ?? null,
    encryptionKeyDetails: encryptionKeyDetails ?? null,
    createdAt: Date.now(),
  });

  return json({ fingerprint });
}

async function handlePostDetail(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<DetailPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  // Validate field lengths
  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;

  const pathCheck = validateStringLength(payload.path, "path", LIMITS.path);
  if (!pathCheck.ok) return json({ error: pathCheck.error }, 400);
  const path = pathCheck.value;

  const detailCheck = validateStringLength(payload.detail, "detail", LIMITS.detail, false);
  if (!detailCheck.ok) return json({ error: detailCheck.error }, 400);
  const detail = detailCheck.value;
  if (path === "email" && detail.length === 0) {
    return json({ error: "email detail cannot be empty" }, 400);
  }

  const proofLengthCheck = validateStringLength(payload.proof, "proof", LIMITS.proof);
  if (!proofLengthCheck.ok) return json({ error: proofLengthCheck.error }, 400);
  const proof = proofLengthCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const existingDetail = await getDetailRecord(db, fingerprint, path);
  if (existingDetail && existingDetail.revoked_at === null) {
    return json({ error: "detail already exists for path" }, 409);
  }

  const proofVerifyResult = verifyDetailProof(identity, path, detail, proof);
  if (!proofVerifyResult.ok) {
    return json({ error: proofVerifyResult.error ?? "invalid proof" }, 400);
  }

  const nonceCheck = await ensureNewNonce(db, fingerprint, proofVerifyResult.record.nonce);
  if (!nonceCheck.ok) {
    return json({ error: nonceCheck.error }, 400);
  }

  try {
    const createdAt = proofVerifyResult.record.timestamp ?? Date.now();
    if (existingDetail && existingDetail.revoked_at !== null) {
      await updateDetail(db, { fingerprint, path, detail, proof, createdAt });
    } else {
      await insertDetail(db, { fingerprint, path, detail, proof, createdAt });
    }

    if (path === "email") {
      const token = generateVerificationToken();
      const tokenHash = computeTokenHash(token);
      const now = Date.now();
      await updateDetailVerification(db, {
        fingerprint,
        path,
        verifiedAt: null,
        verificationToken: EMAIL_VERIFICATION_STORE_PLAINTEXT ? token : null,
        verificationTokenHash: tokenHash,
        verificationExpiresAt: now + EMAIL_VERIFICATION_TTL_MS,
        verificationSentAt: now,
      });

      const baseUrl = getPublicBaseUrl(req);
      if (!baseUrl) {
        console.warn("public base URL not configured; skipping verification email");
        return json({ ok: true, warning: "verification_email_not_sent" });
      }

      const link = `${baseUrl}/api/v1/verify-email?token=${encodeURIComponent(token)}`;
      try {
        await sendVerificationEmail(detail, link, fingerprint);
      } catch (err) {
        console.error("failed to send verification email:", err);
      }
    }
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return json({ error: "detail already exists for path" }, 409);
    }
    console.error(e);
    return json({ error: "failed to store detail" }, 500);
  }

  return json({ ok: true });
}

async function handleRequestVerifyEmail(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;

  const detailCheck = validateStringLength(payload.detail, "detail", LIMITS.detail, true);
  if (!detailCheck.ok) return json({ error: detailCheck.error }, 400);
  const providedDetail = detailCheck.value;

  const record = await getDetailRecord(db, fingerprint, "email");
  if (!record) {
    return json({ error: "email detail not found" }, 404);
  }
  if (record.revoked_at !== null) {
    return json({ error: "email detail is revoked" }, 409);
  }
  if (record.detail !== providedDetail) {
    return json({ error: "email detail mismatch" }, 409);
  }
  if (record.verified_at !== null) {
    return json({ ok: true, status: "already_verified" });
  }

  const token = generateVerificationToken();
  const tokenHash = computeTokenHash(token);
  const now = Date.now();
  await updateDetailVerification(db, {
    fingerprint,
    path: "email",
    verifiedAt: null,
    verificationToken: EMAIL_VERIFICATION_STORE_PLAINTEXT ? token : null,
    verificationTokenHash: tokenHash,
    verificationExpiresAt: now + EMAIL_VERIFICATION_TTL_MS,
    verificationSentAt: now,
  });

  const baseUrl = getPublicBaseUrl(req);
  if (!baseUrl) {
    return json({ error: "public base url not configured" }, 500);
  }

  const link = `${baseUrl}/api/v1/verify-email?token=${encodeURIComponent(token)}`;
  try {
    await sendVerificationEmail(record.detail, link, fingerprint);
  } catch (err) {
    console.error("failed to send verification email:", err);
  }

  return json({ ok: true, status: "sent" });
}

function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

function html(body: string, status = 200, corsHeaders?: HeadersInit): Response {
  const securityHeaders = buildSecurityHeaders();
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...securityHeaders,
      ...corsHeaders,
    },
  });
}

function renderVerifyEmailPage(options: {
  title: string;
  message: string;
  token?: string;
  showButton?: boolean;
}): string {
  const buttonHtml = options.showButton && options.token
    ? `<form method="POST" action="/api/v1/verify-email">
    <input type="hidden" name="token" value="${options.token}">
    <button type="submit">Confirm email verification</button>
  </form>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${options.title}</title>
  </head>
  <body>
    <h1>${options.title}</h1>
    <p>${options.message}</p>
    ${buttonHtml}
  </body>
</html>`;
}

async function readVerificationTokenFromRequest(req: Request): Promise<{ ok: true; token: string } | { ok: false; error: string; status: number }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const bodyResult = await readJsonBody<Record<string, unknown>>(req);
    if (!bodyResult.ok) {
      return { ok: false, error: bodyResult.error, status: bodyResult.status };
    }
    const tokenCheck = validateStringLength(bodyResult.data.token, "token", LIMITS.verificationToken);
    if (!tokenCheck.ok) return { ok: false, error: tokenCheck.error, status: 400 };
    return { ok: true, token: tokenCheck.value };
  }

  const bodyText = await req.text();
  const params = new URLSearchParams(bodyText);
  const tokenCheck = validateStringLength(params.get("token"), "token", LIMITS.verificationToken);
  if (!tokenCheck.ok) return { ok: false, error: tokenCheck.error, status: 400 };
  return { ok: true, token: tokenCheck.value };
}

function handleVerifyEmailPage(url: URL): Response {
  const tokenCheck = validateStringLength(url.searchParams.get("token"), "token", LIMITS.verificationToken);
  if (!tokenCheck.ok) {
    return html(renderVerifyEmailPage({
      title: "Email verification failed",
      message: tokenCheck.error,
    }), 400);
  }

  return html(renderVerifyEmailPage({
    title: "Confirm email verification",
    message: "Click the button below to confirm your email verification.",
    token: tokenCheck.value,
    showButton: true,
  }));
}

async function handleVerifyEmailConfirm(req: Request, db: DatabaseAdapter): Promise<Response> {
  const tokenResult = await readVerificationTokenFromRequest(req);
  if (!tokenResult.ok) {
    return wantsJson(req)
      ? json({ error: tokenResult.error }, tokenResult.status)
      : html(renderVerifyEmailPage({
        title: "Email verification failed",
        message: tokenResult.error,
      }), tokenResult.status);
  }
  const token = tokenResult.token;
  const tokenHash = computeTokenHash(token);

  const record = await getDetailByVerificationToken(db, tokenHash, token);
  if (!record) {
    return wantsJson(req)
      ? json({ error: "token not found" }, 404)
      : html(renderVerifyEmailPage({
        title: "Email verification failed",
        message: "Token not found.",
      }), 404);
  }
  if (record.path !== "email") {
    return wantsJson(req)
      ? json({ error: "token not valid for email verification" }, 400)
      : html(renderVerifyEmailPage({
        title: "Email verification failed",
        message: "Token not valid for email verification.",
      }), 400);
  }
  if (record.revoked_at !== null) {
    return wantsJson(req)
      ? json({ error: "email detail is revoked" }, 409)
      : html(renderVerifyEmailPage({
        title: "Email verification failed",
        message: "Email detail is revoked.",
      }), 409);
  }
  if (record.verification_expires_at !== null && Date.now() > record.verification_expires_at) {
    return wantsJson(req)
      ? json({ error: "token expired" }, 400)
      : html(renderVerifyEmailPage({
        title: "Email verification failed",
        message: "Token expired.",
      }), 400);
  }
  if (record.verified_at !== null) {
    return wantsJson(req)
      ? json({ ok: true, status: "already_verified" })
      : html(renderVerifyEmailPage({
        title: "Email already verified",
        message: "Your email address is already verified.",
      }));
  }

  const now = Date.now();
  await updateDetailVerification(db, {
    fingerprint: record.fingerprint,
    path: record.path,
    verifiedAt: now,
    verificationToken: null,
    verificationTokenHash: null,
    verificationExpiresAt: null,
    verificationSentAt: record.verification_sent_at,
  });

  return wantsJson(req)
    ? json({ ok: true, status: "verified" })
    : html(renderVerifyEmailPage({
      title: "Email verified",
      message: "Your email address has been verified.",
    }));
}

async function handleGetIdentity(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  // Validate fingerprint length
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const details = await getDetailsMap(db, fingerprint);
  const detailsMeta = await getDetailsMetaMap(db, fingerprint);
  const revoked = await isIdentityRevoked(db, fingerprint);
  const revokedDetailPaths = await getRevokedDetailPaths(db, fingerprint);

  return json({
    fingerprint,
    signingKeyType: identity.signing_key_type,
    encryptionKeyType: identity.encryption_key_type,
    signingKey: identity.signing_key,
    encryptionKey: identity.encryption_key,
    signingKeyDetails: identity.signing_key_details,
    encryptionKeyDetails: identity.encryption_key_details,
    details,
    detailsMeta,
    revoked,
    revocationCertificate: identity.revocation_certificate ?? undefined,
    revokedDetails: revokedDetailPaths,
  });
}

async function handlePostRevocation(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<RevocationPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  // Validate field lengths
  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;

  const type = payload.type;
  if (type !== "detail" && type !== "identity") {
    return json({ error: "invalid revocation type (must be 'detail' or 'identity')" }, 400);
  }

  const targetCheck = validateStringLength(payload.target, "target", LIMITS.path, type === "detail");
  if (!targetCheck.ok) return json({ error: targetCheck.error }, 400);
  const target = targetCheck.value || undefined;

  if (type === "detail" && !target) {
    return json({ error: "detail revocation requires target path" }, 400);
  }

  const certificateCheck = validateStringLength(payload.certificate, "certificate", LIMITS.certificate);
  if (!certificateCheck.ok) return json({ error: certificateCheck.error }, 400);
  const certificate = certificateCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  // Check if identity is already revoked
  if (type === "identity" && await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "identity is already revoked" }, 409);
  }

  // Check if detail is already revoked
  if (type === "detail" && await isDetailRevoked(db, fingerprint, target!)) {
    return json({ error: "detail is already revoked" }, 409);
  }

  // Verify the revocation certificate
  const verifyResult = verifyRevocationCertificate(identity, certificate, type, target);
  if (!verifyResult.ok) {
    return json({ error: verifyResult.error ?? "invalid certificate" }, 400);
  }

  const record = verifyResult.record;

  // Check nonce is valid
  // Special case: nonce 0 is allowed for identity revocations (emergency certificates)
  // as long as nonce 0 hasn't been used yet
  const maxNonce = await getMaxRevocationNonce(db, fingerprint);
  
  if (record.nonce === 0 && type === "identity") {
    // Emergency revocation certificate - check if nonce 0 already used
    if (await hasRevocationWithNonce(db, fingerprint, 0)) {
      return json({ error: "emergency revocation certificate already used" }, 400);
    }
  } else if (record.nonce <= maxNonce) {
    return json({ error: "revocation nonce must be greater than previous revocations" }, 400);
  }

  // Store the revocation
  const now = Date.now();
  await insertRevocation(db, {
    fingerprint,
    type,
    target: target ?? null,
    nonce: record.nonce,
    certificate,
    createdAt: now,
  });

  // Update the relevant record
  if (type === "identity") {
    await revokeIdentity(db, fingerprint, certificate, now);
  } else {
    await revokeDetail(db, fingerprint, target!, certificate, now);
  }

  return json({ ok: true, type, target: target ?? undefined });
}

async function handleGetRevocations(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  // Validate fingerprint length
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const revocations = await getRevocations(db, fingerprint);
  
  return json({
    fingerprint,
    revoked: await isIdentityRevoked(db, fingerprint),
    revocationCertificate: identity.revocation_certificate ?? undefined,
    revocations: revocations.map(r => ({
      type: r.type,
      target: r.target,
      nonce: r.nonce,
      certificate: r.certificate,
      createdAt: r.created_at,
    })),
  });
}

// Exports for testing
export { handleListIdentities, handleSearchIdentities, handleRequest, closeDb };
export async function getDbForTests(): Promise<DatabaseAdapter> {
  return await getDb();
}

const DEFAULT_PAGE_SIZE = 5;

async function handleListIdentities(url: URL, db: DatabaseAdapter): Promise<Response> {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  // Get total count (respecting revoked filter)
  const countQuery = includeRevoked
    ? "SELECT COUNT(*) FROM identities"
    : "SELECT COUNT(*) FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";
  const totalCountRows = await db.query<[number | string | bigint]>(countQuery);
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  // Fetch paginated identities (respecting revoked filter)
  const listQuery = includeRevoked
    ? "SELECT fingerprint, signing_key_type, encryption_key_type, created_at FROM identities ORDER BY created_at ASC LIMIT ? OFFSET ?"
    : "SELECT fingerprint, signing_key_type, encryption_key_type, created_at FROM identities i WHERE NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity') ORDER BY created_at ASC LIMIT ? OFFSET ?";
  const identityRows = await db.query<[string, string, string, number | string | bigint]>(listQuery, [limit, offset]);

  const fingerprints: string[] = [];
  const rows: Array<{
    fingerprint: string;
    signingKeyType: string;
    encryptionKeyType: string;
    createdAt: number;
    details: Record<string, [string, string]>;
    detailsMeta: Record<string, { verified: boolean; verifiedAt: number | null }>;
    revoked: boolean;
    revokedDetails: string[];
    revocationCertificate?: string | null;
  }> = [];
  
  for (const [fp, skt, ekt, createdAt] of identityRows) {
    const createdAtNumber = coerceNumber(createdAt) ?? 0;
    fingerprints.push(fp);
    rows.push({
      fingerprint: fp,
      signingKeyType: skt,
      encryptionKeyType: ekt,
      createdAt: createdAtNumber,
      details: {},
      detailsMeta: {},
      revoked: false,
      revokedDetails: [],
      revocationCertificate: null,
    });
  }

  // Fetch details only for the identities on this page
  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    const detailRows = await db.query<[string, string, string, string, number | string | bigint | null]>(
      `SELECT identity_fingerprint, path, detail, proof, verified_at FROM details WHERE identity_fingerprint IN (${placeholders}) ORDER BY id ASC`,
      fingerprints,
    );
    
    const detailsByFp: Record<string, Record<string, [string, string]>> = {};
    const detailsMetaByFp: Record<string, Record<string, { verified: boolean; verifiedAt: number | null }>> = {};
    for (const [identityFp, path, detail, proof, verified_at] of detailRows) {
      if (!detailsByFp[identityFp]) {
        detailsByFp[identityFp] = {};
      }
      if (!detailsMetaByFp[identityFp]) {
        detailsMetaByFp[identityFp] = {};
      }
      detailsByFp[identityFp][path] = [detail, proof];
      const verifiedAt = coerceNumber(verified_at);
      detailsMetaByFp[identityFp][path] = { verified: verifiedAt !== null, verifiedAt };
    }

    for (const row of rows) {
      row.details = detailsByFp[row.fingerprint] ?? {};
      row.detailsMeta = detailsMetaByFp[row.fingerprint] ?? {};
    }

    // Apply revocations: drop revoked details and mark revoked identities
    for (const row of rows) {
      const revokedDetails = await getRevokedDetailPaths(db, row.fingerprint);
      row.revokedDetails = revokedDetails;
      // Remove revoked details from the list we return
      for (const path of revokedDetails) {
        delete row.details[path];
        delete row.detailsMeta[path];
      }

      const revoked = await isIdentityRevoked(db, row.fingerprint);
      row.revoked = revoked;
      if (revoked) {
        const identityRow = await getIdentity(db, row.fingerprint);
        row.revocationCertificate = identityRow?.revocation_certificate ?? null;
      }
    }
  }

  const totalPages = Math.ceil(totalCount / limit);

  return json({
    identities: rows,
    pagination: {
      page,
      pageSize: limit,
      total: totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
}

async function handleSearchIdentities(url: URL, db: DatabaseAdapter): Promise<Response> {
  const rawQuery = (url.searchParams.get("query") ?? url.searchParams.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * limit;
  const includeRevoked = url.searchParams.get("includeRevoked") === "true";

  // Validate search query length
  if (rawQuery.length > LIMITS.searchQuery) {
    return json({ error: `search query too long (max ${LIMITS.searchQuery} characters)` }, 400);
  }

  if (!rawQuery) {
    return json({
      identities: [],
      pagination: {
        page,
        pageSize: limit,
        total: 0,
        totalPages: 0,
        hasMore: false,
      },
    });
  }

  const like = `%${rawQuery}%`;

  const baseJoin =
    "FROM identities i LEFT JOIN details d ON d.identity_fingerprint = i.fingerprint AND d.path IN ('name', 'email')";
  const matchClause = "(LOWER(i.fingerprint) LIKE ? OR LOWER(d.detail) LIKE ?)";
  const revokedFilter = includeRevoked
    ? ""
    : "AND NOT EXISTS (SELECT 1 FROM revocations r WHERE r.identity_fingerprint = i.fingerprint AND r.type = 'identity')";

  const countQuery = `SELECT COUNT(DISTINCT i.fingerprint) ${baseJoin} WHERE ${matchClause} ${revokedFilter}`;
  const totalCountRows = await db.query<[number | string | bigint]>(countQuery, [like, like]);
  const totalCount = coerceNumber(totalCountRows[0]?.[0] ?? null) ?? 0;

  const listQuery =
    `SELECT DISTINCT i.fingerprint, i.signing_key_type, i.encryption_key_type, i.created_at ` +
    `${baseJoin} WHERE ${matchClause} ${revokedFilter} ORDER BY i.created_at ASC LIMIT ? OFFSET ?`;
  const identityRows = await db.query<[string, string, string, number | string | bigint]>(listQuery, [like, like, limit, offset]);

  const fingerprints: string[] = [];
  const rows: Array<{
    fingerprint: string;
    signingKeyType: string;
    encryptionKeyType: string;
    createdAt: number;
    details: Record<string, [string, string]>;
    detailsMeta: Record<string, { verified: boolean; verifiedAt: number | null }>;
    revoked: boolean;
    revokedDetails: string[];
    revocationCertificate?: string | null;
  }> = [];

  for (const [fp, skt, ekt, createdAt] of identityRows) {
    const createdAtNumber = coerceNumber(createdAt) ?? 0;
    fingerprints.push(fp);
    rows.push({
      fingerprint: fp,
      signingKeyType: skt,
      encryptionKeyType: ekt,
      createdAt: createdAtNumber,
      details: {},
      detailsMeta: {},
      revoked: false,
      revokedDetails: [],
      revocationCertificate: null,
    });
  }

  if (fingerprints.length > 0) {
    const placeholders = fingerprints.map(() => "?").join(",");
    const detailRows = await db.query<[string, string, string, string, number | string | bigint | null]>(
      `SELECT identity_fingerprint, path, detail, proof, verified_at FROM details WHERE identity_fingerprint IN (${placeholders}) ORDER BY id ASC`,
      fingerprints,
    );

    const detailsByFp: Record<string, Record<string, [string, string]>> = {};
    const detailsMetaByFp: Record<string, Record<string, { verified: boolean; verifiedAt: number | null }>> = {};
    for (const [identityFp, path, detail, proof, verified_at] of detailRows) {
      if (!detailsByFp[identityFp]) {
        detailsByFp[identityFp] = {};
      }
      if (!detailsMetaByFp[identityFp]) {
        detailsMetaByFp[identityFp] = {};
      }
      detailsByFp[identityFp][path] = [detail, proof];
      const verifiedAt = coerceNumber(verified_at);
      detailsMetaByFp[identityFp][path] = { verified: verifiedAt !== null, verifiedAt };
    }

    for (const row of rows) {
      row.details = detailsByFp[row.fingerprint] ?? {};
      row.detailsMeta = detailsMetaByFp[row.fingerprint] ?? {};
    }

    for (const row of rows) {
      const revokedDetails = await getRevokedDetailPaths(db, row.fingerprint);
      row.revokedDetails = revokedDetails;
      for (const path of revokedDetails) {
        delete row.details[path];
        delete row.detailsMeta[path];
      }

      const revoked = await isIdentityRevoked(db, row.fingerprint);
      row.revoked = revoked;
      if (revoked) {
        const identityRow = await getIdentity(db, row.fingerprint);
        row.revocationCertificate = identityRow?.revocation_certificate ?? null;
      }
    }
  }

  const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

  return json({
    identities: rows,
    pagination: {
      page,
      pageSize: limit,
      total: totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
}