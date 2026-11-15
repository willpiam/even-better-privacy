import { FILE_FORMAT_VERSIONS } from "../../core/version.ts";
import { apiUrl, getContext } from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { loadIdentity, resolveServer } from "./identity.ts";
import { mutateIdentityForRequest } from "./unlock-session.ts";

export async function handleRevocationRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/revoke/detail") {
    const body = await readJson<{
      path?: unknown;
      reason?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      push?: unknown;
      server?: unknown;
    }>(req);
    const path = typeof body.path === "string" ? body.path : undefined;
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const push = Boolean(body.push);
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;
    if (!path) throw new HttpError(STATUS.BadRequest, "path is required");

    const ctx = await getContext(home, identityName);
    const { identity, result: certificate } = await mutateIdentityForRequest(
      ctx,
      password,
      (current) => {
        if (!current.details.has(path)) {
          throw new HttpError(STATUS.NotFound, "detail not found");
        }
        return current.revokeDetail(path, reason);
      },
    );

    if (push) {
      const server = resolveServer(ctx, serverOverride);
      const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint: identity.toFingerprint(),
          type: "detail",
          target: path,
          certificate,
        }),
      });

      if (!res.ok) {
        let pushReason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) pushReason = body.error;
        } catch {
          // ignore
        }
        throw new HttpError(
          STATUS.BadGateway,
          `failed to push revocation: ${pushReason}`,
        );
      }
    }

    return json({ ok: true, path, revoked: true });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/revoke/identity") {
    const body = await readJson<{
      reason?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      push?: unknown;
      server?: unknown;
    }>(req);
    const reason = typeof body.reason === "string" ? body.reason : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const push = Boolean(body.push);
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;

    const ctx = await getContext(home, identityName);
    const { identity, result: certificate } = await mutateIdentityForRequest(
      ctx,
      password,
      (current) => {
        if (current.isRevoked()) {
          throw new HttpError(STATUS.Conflict, "identity is already revoked");
        }
        return current.createIdentityRevocation(reason);
      },
    );

    if (push) {
      const server = resolveServer(ctx, serverOverride);
      const res = await fetch(apiUrl(server, "/api/v1/revoke"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint: identity.toFingerprint(),
          type: "identity",
          certificate,
        }),
      });

      if (!res.ok) {
        let pushReason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) pushReason = body.error;
        } catch {
          // ignore
        }
        throw new HttpError(
          STATUS.BadGateway,
          `failed to push revocation: ${pushReason}`,
        );
      }
    }

    return json({
      ok: true,
      revoked: true,
      fingerprint: identity.toFingerprint(),
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/revoke/emergency-cert"
  ) {
    const body = await readJson<{
      password?: unknown;
      home?: unknown;
      identity?: unknown;
    }>(req);
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;

    if (!password) {
      throw new HttpError(STATUS.BadRequest, "password required");
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentity(ctx, password);

    const emergencyCert = identity.generateEmergencyRevocationCertificate();

    return json({
      type: "ebp-emergency-revocation-certificate",
      version: FILE_FORMAT_VERSIONS.emergencyRevocationCertificate,
      fingerprint: identity.toFingerprint(),
      certificate: emergencyCert,
      createdAt: new Date().toISOString(),
      warning:
        "KEEP THIS SECURE. Anyone with this certificate can revoke your identity.",
    });
  }

  return null;
}
