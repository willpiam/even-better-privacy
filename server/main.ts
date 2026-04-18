#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { PROTOCOL_VERSION } from "../core/version.ts";
import { COMPONENT_VERSIONS } from "../app-version.ts";
import { initDb } from "./db.ts";
import type { DatabaseAdapter } from "./db.ts";
import { isOriginAllowed, buildCorsHeaders } from "./cors.ts";
import { checkRateLimit, getClientIp, RATE_LIMIT_DISABLED, RATE_LIMIT_CLEANUP } from "./rate-limit.ts";
import { json, attachCors, logRequest, generateTraceId } from "./response.ts";
import { handleOAuthExchange, handleOAuthRefresh } from "./mail-oauth.ts";
import {
  handleRequestVerifyEmail,
  handleVerifyEmailPage,
  handleVerifyEmailConfirm,
} from "./verify-email.ts";
import { handlePostIdentity, handleGetIdentity, handlePostDetail } from "./handlers/identity.ts";
import { handleVerifySignature } from "./handlers/verify.ts";
import { handlePostRevocation, handleGetRevocations } from "./handlers/revocation.ts";
import {
  handlePostHierarchy,
  handlePostHierarchyPropose,
  handlePostHierarchyAccept,
  handlePostHierarchyReject,
  handleGetHierarchyPending,
  handleGetHierarchy,
  handleGetHierarchyCertificate,
} from "./handlers/hierarchy.ts";
import { handleListIdentities, handleSearchIdentities } from "./handlers/discovery.ts";

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
    if (origin && !isOriginAllowed(origin)) {
      return jsonResponse({ error: "origin not allowed" }, 403);
    }

    if (req.method === "OPTIONS") {
      return respond(new Response(null, { status: 204, headers: corsHeaders }));
    }

    if (!RATE_LIMIT_DISABLED && url.pathname !== "/api/v1/health") {
      const rateLimitError = checkRateLimit(clientIp, req.method, url.pathname);
      if (rateLimitError) {
        return jsonResponse({ error: rateLimitError }, 429);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/v1/health") {
      return jsonResponse({
        status: "ok",
        protocolVersion: PROTOCOL_VERSION,
        componentVersion: COMPONENT_VERSIONS.server,
      });
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

    if (req.method === "POST" && url.pathname === "/api/v1/verify-signature") {
      return respond(attachCors(await handleVerifySignature(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/revoke") {
      return respond(attachCors(await handlePostRevocation(req, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/revocations/")) {
      const fingerprint = url.pathname.split("/").pop()!;
      return respond(attachCors(await handleGetRevocations(fingerprint, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy") {
      return respond(attachCors(await handlePostHierarchy(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/propose") {
      return respond(attachCors(await handlePostHierarchyPropose(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/accept") {
      return respond(attachCors(await handlePostHierarchyAccept(req, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/reject") {
      return respond(attachCors(await handlePostHierarchyReject(req, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/hierarchy/pending/")) {
      const fingerprint = url.pathname.split("/").pop()!;
      return respond(attachCors(await handleGetHierarchyPending(fingerprint, db), corsHeaders));
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/v1/hierarchy/")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const fingerprint = parts[3] ?? "";
      const suffix = parts[4] ?? "";
      if (suffix === "certificate") {
        return respond(attachCors(await handleGetHierarchyCertificate(fingerprint, db), corsHeaders));
      }
      return respond(attachCors(await handleGetHierarchy(fingerprint, db), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/oauth/exchange") {
      return respond(attachCors(await handleOAuthExchange(req), corsHeaders));
    }

    if (req.method === "POST" && url.pathname === "/api/v1/mail/oauth/refresh") {
      return respond(attachCors(await handleOAuthRefresh(req), corsHeaders));
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

// Exports for testing
export { handleListIdentities, handleSearchIdentities, handleRequest, closeDb };
export async function getDbForTests(): Promise<DatabaseAdapter> {
  return await getDb();
}
