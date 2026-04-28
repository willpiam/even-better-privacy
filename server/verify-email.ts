import nodemailer from "npm:nodemailer";
import { readJsonBody, validateStringLength, LIMITS } from "./body.ts";
import { json, escapeHtml } from "./response.ts";
import { buildSecurityHeaders } from "./cors.ts";
import { computeTokenHash, toHex } from "./crypto.ts";
import {
  getDetailByVerificationToken,
  getDetailRecord,
  updateDetailVerification,
} from "./db/index.ts";
import type { DatabaseAdapter } from "./db/index.ts";
import { isValidFingerprintBech32 } from "../core/Fingerprint.ts";

// =============================================================================
// Email Verification Configuration
// =============================================================================

export const EMAIL_VERIFICATION_TTL_MS =
  Number(Deno.env.get("EMAIL_VERIFICATION_TTL_MS") ?? String(24 * 60 * 60 * 1000));

export const EMAIL_VERIFICATION_STORE_PLAINTEXT =
  (Deno.env.get("EMAIL_VERIFICATION_STORE_PLAINTEXT") ?? "false").toLowerCase() === "true";

export function generateVerificationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export function isLocalHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  return hostname.endsWith(".localhost");
}

export function getPublicBaseUrl(req: Request): string | null {
  const configured = Deno.env.get("PUBLIC_BASE_URL");
  if (configured) return configured;

  const url = new URL(req.url);
  if (isLocalHostname(url.hostname)) return url.origin;

  return null;
}

export async function sendVerificationEmail(to: string, link: string, fingerprint: string): Promise<void> {
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

export function wantsJson(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  return accept.includes("application/json");
}

export function html(body: string, status = 200, corsHeaders?: HeadersInit): Response {
  const securityHeaders = buildSecurityHeaders();
  // F-SERVER-01: strong CSP on verify-email HTML so an attacker who finds a
  // future escape path still cannot execute script. `unsafe-inline` on
  // `style-src` is intentional because the page uses none today and adding
  // it is cheap; no inline <style> is needed but future tweaks won't break.
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...securityHeaders,
      ...corsHeaders,
    },
  });
}

export function renderVerifyEmailPage(options: {
  title: string;
  message: string;
}): string {
  // F-SERVER-01: every interpolation site must HTML-escape user-controlled
  // data. `title` and `message` reach this function from query-parameter
  // and validation-error strings; `token` is attacker-controlled via the
  // `token` query param.
  const safeTitle = escapeHtml(options.title);
  const safeMessage = escapeHtml(options.message);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${safeTitle}</title>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    <p id="message">${safeMessage}</p>
    <button id="confirmBtn" type="button">Confirm email verification</button>
    <script>
      (function () {
        const msg = document.getElementById("message");
        const btn = document.getElementById("confirmBtn");
        const token = decodeURIComponent((window.location.hash || "").replace(/^#token=/, ""));
        if (!token) {
          if (msg) msg.textContent = "Missing token in verification link.";
          if (btn) btn.style.display = "none";
          return;
        }
        btn && btn.addEventListener("click", async () => {
          try {
            const res = await fetch("/api/v1/verify-email", {
              method: "POST",
              headers: { "content-type": "application/json", "accept": "application/json" },
              body: JSON.stringify({ token }),
            });
            const body = await res.json().catch(() => ({}));
            if (res.ok) {
              if (msg) msg.textContent = "Your email address has been verified.";
              if (btn) btn.style.display = "none";
              return;
            }
            if (msg) msg.textContent = typeof body.error === "string" ? body.error : "Email verification failed.";
          } catch {
            if (msg) msg.textContent = "Email verification failed.";
          }
        });
      })();
    </script>
  </body>
</html>`;
}

export async function readVerificationTokenFromRequest(req: Request): Promise<{ ok: true; token: string } | { ok: false; error: string; status: number }> {
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

export async function handleRequestVerifyEmail(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

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

  // F-SERVER-09: keep tokens out of request URLs/logs by placing them in the
  // fragment; fragments are processed client-side and never sent to the server.
  const link = `${baseUrl}/api/v1/verify-email#token=${encodeURIComponent(token)}`;
  try {
    await sendVerificationEmail(record.detail, link, fingerprint);
  } catch (err) {
    console.error("failed to send verification email:", err);
  }

  return json({ ok: true, status: "sent" });
}

export function handleVerifyEmailPage(url: URL): Response {
  // F-SERVER-09: ignore query token entirely; verification token lives in
  // the URL fragment and is submitted via POST.
  void url;
  return html(renderVerifyEmailPage({
    title: "Confirm email verification",
    message: "Click the button below to confirm your email verification.",
  }));
}

export async function handleVerifyEmailConfirm(req: Request, db: DatabaseAdapter): Promise<Response> {
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
