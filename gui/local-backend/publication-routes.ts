import { type ExternalIdentity } from "../../core/Identity.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
  apiUrl,
  buildStateFromExternal,
  computeStateHash,
  getContext,
  stableStringify,
} from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { loadIdentityPublic, resolveServer } from "./identity.ts";
import {
  loadIdentityForRequest,
  mutateIdentityForRequest,
} from "./unlock-session.ts";
import { saveExternalContact } from "./contacts.ts";

export async function handlePublicationRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/detail") {
    const body = await readJson<{
      path?: unknown;
      detail?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      push?: unknown;
      server?: unknown;
    }>(req);
    const path = typeof body.path === "string" ? body.path : undefined;
    const detail = typeof body.detail === "string" ? body.detail : undefined;
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
    if (!path || !detail) {
      throw new HttpError(STATUS.BadRequest, "path and detail are required");
    }

    const ctx = await getContext(home, identityName);
    const detailToAttach = path.startsWith("opaque::")
      ? sha256Hex(detail)
      : detail;
    const { identity } = await mutateIdentityForRequest(
      ctx,
      password,
      (current) => {
        current.attachDetail(path, detailToAttach);
      },
    );

    if (push) {
      const server = resolveServer(ctx, serverOverride);
      const entry = identity.details.get(path);
      if (!entry) {
        throw new HttpError(
          STATUS.InternalServerError,
          "failed to locate attached detail",
        );
      }
      const [detailValue, proof] = entry;

      const res = await fetch(apiUrl(server, "/api/v1/detail"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fingerprint: identity.toFingerprint(),
          path,
          detail: detailValue,
          proof,
        }),
      });

      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) reason = body.error;
        } catch {
          // ignore
        }
        throw new HttpError(
          STATUS.BadGateway,
          `failed to push detail: ${reason}`,
        );
      }
    }

    return json({ ok: true, path, detail: detailToAttach });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/verify-email/request"
  ) {
    const body = await readJson<{
      home?: unknown;
      identity?: unknown;
      server?: unknown;
      fingerprint?: unknown;
      detail?: unknown;
      path?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;
    const providedFingerprint = typeof body.fingerprint === "string"
      ? body.fingerprint
      : undefined;
    const detail = typeof body.detail === "string" ? body.detail : undefined;
    const path = typeof body.path === "string" ? body.path : undefined;

    const ctx = await getContext(home, identityName);
    const server = resolveServer(ctx, serverOverride);
    const publicData = await loadIdentityPublic(ctx);
    const fingerprint = providedFingerprint ?? publicData?.fingerprint ??
      null;
    if (!fingerprint) {
      throw new HttpError(STATUS.NotFound, "identity fingerprint not found");
    }

    const res = await fetch(apiUrl(server, "/api/v1/verify-email/request"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fingerprint,
        detail,
        ...(path ? { path } : {}),
      }),
    });

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) reason = body.error;
      } catch {
        // ignore
      }
      throw new HttpError(
        STATUS.BadGateway,
        `failed to send verification email: ${reason}`,
      );
    }

    const payload = await res.json();
    return json(payload);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/publish") {
    const body = await readJson<{
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      server?: unknown;
    }>(req);
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;

    const ctx = await getContext(home, identityName);
    const server = resolveServer(ctx, serverOverride);
    const identity = await loadIdentityForRequest(ctx, password);
    const summary = identity.summary;

    let serverIdentity: ExternalIdentity | null = null;
    try {
      const res = await fetch(
        apiUrl(server, `/api/v1/identity/${summary.fingerprint}`),
      );
      if (res.ok) {
        const body = await res.json();
        serverIdentity = {
          fingerprint: body.fingerprint,
          signingKeyType: body.signingKeyType,
          encryptionKeyType: body.encryptionKeyType,
          signingKey: body.signingKey,
          encryptionKey: body.encryptionKey,
          signingKeyDetails: (body
            .signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
            { variant: "ml_dsa87" },
          encryptionKeyDetails: (body
            .encryptionKeyDetails as ExternalIdentity[
              "encryptionKeyDetails"
            ]) ?? { variant: "ml_kem1024" },
          details: body.details ?? {},
        };
      } else {
        // Server returns 400 "unknown subject" (formerly 404) when the
        // fingerprint is not registered yet — treat that as "not published".
        const body = await res.json().catch(() => ({})) as {
          error?: string;
        };
        const unknown = res.status === 404 ||
          (res.status === 400 && body?.error === "unknown subject");
        if (!unknown) {
          const reason = body?.error ?? `HTTP ${res.status}`;
          throw new HttpError(
            STATUS.BadGateway,
            `failed to query server identity: ${reason}`,
          );
        }
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        STATUS.BadGateway,
        `failed to query server identity: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }

    if (serverIdentity) {
      if (
        serverIdentity.signingKey !== summary.signingKey ||
        serverIdentity.encryptionKey !== summary.encryptionKey ||
        serverIdentity.signingKeyType !== summary.signingKeyType ||
        serverIdentity.encryptionKeyType !== summary.encryptionKeyType
      ) {
        throw new HttpError(
          STATUS.Conflict,
          "server identity keys differ from local identity",
        );
      }
    }

    const serverDetails: Record<string, [string, string]> =
      serverIdentity?.details ?? {};
    const serverState = serverIdentity
      ? buildStateFromExternal(serverIdentity, serverDetails)
      : null;
    const fromState = serverState ? computeStateHash(serverState) : null;

    const nextState = buildStateFromExternal(
      {
        ...summary,
        details: serverDetails,
      },
      serverDetails,
    );
    const toState = computeStateHash(nextState);
    const transitionMessage = stableStringify({ fromState, toState });
    const stateSignature = identity.signMessage(transitionMessage);

    const publishPayload = {
      signingKeyType: summary.signingKeyType,
      encryptionKeyType: summary.encryptionKeyType,
      signingKey: summary.signingKey,
      encryptionKey: summary.encryptionKey,
      signingKeyDetails: summary.signingKeyDetails,
      encryptionKeyDetails: summary.encryptionKeyDetails,
      fingerprint: summary.fingerprint,
      fromState,
      toState,
      stateSignature,
    };

    const res = await fetch(apiUrl(server, "/api/v1/identity"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(publishPayload),
    });

    if (!res.ok) {
      let reason = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) reason = body.error;
      } catch {
        // ignore
      }
      throw new HttpError(
        STATUS.BadGateway,
        `failed to publish identity: ${reason}`,
      );
    }

    return json({ ok: true, fingerprint: summary.fingerprint });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/fetch") {
    const body = await readJson<{
      fingerprint?: unknown;
      name?: unknown;
      home?: unknown;
      server?: unknown;
    }>(req);
    const fingerprint = typeof body.fingerprint === "string"
      ? body.fingerprint
      : undefined;
    const name = typeof body.name === "string" ? body.name : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;
    if (!fingerprint) {
      throw new HttpError(STATUS.BadRequest, "fingerprint is required");
    }
    if (!isValidFingerprintBech32(fingerprint)) {
      throw new HttpError(
        STATUS.BadRequest,
        "fingerprint must be valid bech32",
      );
    }

    const ctx = await getContext(home);
    const server = resolveServer(ctx, serverOverride);
    const res = await fetch(
      apiUrl(server, `/api/v1/identity/${fingerprint}`),
    );
    let bodyJson: unknown = {};
    try {
      bodyJson = await res.json();
    } catch {
      // ignore
    }

    if (!res.ok) {
      const reason = (bodyJson as { error?: string } | undefined)?.error ??
        `HTTP ${res.status}`;
      throw new HttpError(
        STATUS.BadGateway,
        `failed to fetch identity: ${reason}`,
      );
    }

    const b = bodyJson as {
      fingerprint?: string;
      signingKeyType?: string;
      encryptionKeyType?: string;
      signingKey?: string;
      encryptionKey?: string;
      signingKeyDetails?: unknown;
      encryptionKeyDetails?: unknown;
      details?: Record<string, [string, string]>;
      detailsMeta?: Record<
        string,
        { verified: boolean; verifiedAt: number | null }
      >;
      revokedDetails?: string[];
      revoked?: boolean;
    };

    const signingKeyType = b?.signingKeyType === "sphincs"
      ? "sphincs" as const
      : "dilithium" as const;
    const encryptionKeyType = "kyber" as const;

    const details = { ...(b?.details ?? {}) };
    const detailsMeta = { ...(b?.detailsMeta ?? {}) };
    const revokedDetails = b?.revokedDetails ?? [];
    for (const path of revokedDetails) {
      delete details[path];
      delete detailsMeta[path];
    }

    const external: ExternalIdentity = {
      fingerprint: b?.fingerprint ?? fingerprint,
      signingKeyType,
      encryptionKeyType,
      signingKey: b?.signingKey ?? "",
      encryptionKey: b?.encryptionKey ?? "",
      signingKeyDetails:
        (b?.signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
          { variant: "ml_dsa87" },
      encryptionKeyDetails: (b?.encryptionKeyDetails as ExternalIdentity[
        "encryptionKeyDetails"
      ]) ?? { variant: "ml_kem1024" },
      details,
      detailsMeta,
    };

    const saved = await saveExternalContact(ctx, external, name);
    return json({
      ok: true,
      name: saved.name,
      fingerprint: saved.fingerprint,
    });
  }

  return null;
}
