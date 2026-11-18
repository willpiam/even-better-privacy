import { sha256Hex } from "../../core/MessageHash.ts";
import {
  buildMailDeleteDetail,
  buildMailPasswordResetDetail,
  buildMailPaymentOrderDetail,
  MAIL_DELETE_PATH,
  MAIL_PASSWORD_RESET_PATH,
  MAIL_PAYMENT_ORDER_PATH,
  MAIL_PAYMENT_RECOVER_PATH,
  validateMailUsername,
} from "../../common/MailUsername.ts";
import { apiUrl, getContext } from "../../cli/utils.ts";
import { HttpError, json, randomHex, readJson, STATUS } from "./http.ts";
import { loadIdentityPublic, resolveServer, toSafeString } from "./identity.ts";
import {
  loadIdentityForRequest,
  mutateIdentityForRequest,
  unlockIdentity,
} from "./unlock-session.ts";
import {
  getMailSecretsStatus,
  getMailSecretsStore,
  getMailStore,
  mailPinCache,
  saveMailSecretsStore,
  saveMailStore,
} from "./mail-account.ts";
import {
  checkoutOriginForServer,
  fetchEbpMailConfig,
  type MailEndpoint,
  resolveManagedEmail,
  saveEbpMailAccount,
} from "./route-support.ts";

export async function handleManagedMailRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/mail/ebp-payment/cancel") {
    const body = await readJson<{home?: string; server?: string; orderId?: string; confirmUnpaid?: boolean}>(req);
    const server = resolveServer(await getContext(toSafeString(body.home) || undefined), toSafeString(body.server) || undefined);
    const res = await fetch(apiUrl(server, "/api/v1/mail/payment/cancel"), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({orderId: body.orderId, confirmUnpaid: body.confirmUnpaid}),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw new HttpError(STATUS.BadGateway, "Cancellation could not be confirmed. Your setup is still saved. Try again.");
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.status !== "cancelled") {
      throw new HttpError(STATUS.BadGateway, res.status === 404
        ? "This key server could not cancel the purchase. Your setup is still saved."
        : result.error ?? "Cancellation could not be confirmed. Try again.");
    }
    return json({status: "cancelled"});
  }

  if (req.method === "POST" && url.pathname === "/api/v1/mail/ebp-signup/resume-state") {
    const body = await readJson<{home?: string; identity?: string; server?: string; email?: string; orderId?: string}>(req);
    const name = toSafeString(body.identity, 128);
    const email = toSafeString(body.email, 320).toLowerCase();
    if (!name || /[/\\\u0000]/.test(name) || !email) {
      throw new HttpError(STATUS.BadRequest, "identity and email are required");
    }
    const ctx = await getContext(toSafeString(body.home) || undefined, name);
    const identity = await loadIdentityPublic(ctx);
    const server = resolveServer(ctx, toSafeString(body.server) || undefined);
    const store = identity && !identity.revocationCertificate ? await getMailStore(ctx.identityDir).catch(() => null) : null;
    const saved = store?.accounts.some(({config}) => (config.fromEmail || config.username).trim().toLowerCase() === email);
    if (saved && identity?.details?.email?.[0]?.toLowerCase() === email) return json({action: "completed"});

    const read = async (path: string, init?: RequestInit) => {
      const res = await fetch(apiUrl(server, path), {...init, signal: AbortSignal.timeout(4000)});
      return res.ok ? await res.json() : null;
    };
    const [remote, order] = await Promise.all([
      identity && !identity.revocationCertificate
        ? read(`/api/v1/identity/${encodeURIComponent(identity.fingerprint)}`).catch(() => null)
        : null,
      body.orderId ? read("/api/v1/mail/payment/status", {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({orderId: body.orderId, checkPayment: false}),
      }).catch(() => null) : null,
    ]);
    if (order?.status === "cancelled") return json({action: "cancelled"});
    if (!identity || identity.revocationCertificate) {
      return json({action: "unavailable", reason: identity ? "Identity revoked" : "Identity removed from this device"});
    }
    if ((remote?.fingerprint === identity.fingerprint && remote.revoked === true) ||
      (order?.fingerprint && order.fingerprint !== identity.fingerprint)) {
      return json({action: "unavailable", reason: remote?.revoked === true ? "Identity revoked" : "Original identity is missing"});
    }
    const verified = remote?.fingerprint === identity.fingerprint && remote.detailsMeta?.email?.verified === true &&
      !remote.revokedDetails?.includes("email") && remote.details?.email?.[0]?.toLowerCase() === email;
    const fulfilled = order?.status === "fulfilled" && order.fingerprint === identity.fingerprint && order.email?.toLowerCase() === email;
    if (verified || fulfilled) return json({action: saved ? "completed" : "restore"});
    return json({action: "resume"});
  }

  if (
    req.method === "GET" && url.pathname === "/api/v1/mail/ebp-signup/config"
  ) {
    const ctx = await getContext(
      url.searchParams.get("home") ?? undefined,
      url.searchParams.get("identity") ?? undefined,
    );
    const server = resolveServer(
      ctx,
      url.searchParams.get("server") ?? undefined,
    );
    return json({ server, ...(await fetchEbpMailConfig(server)) });
  }

  if (
    req.method === "GET" && url.pathname === "/api/v1/mail/ebp-signup/username"
  ) {
    const ctx = await getContext(
      url.searchParams.get("home") ?? undefined,
      url.searchParams.get("identity") ?? undefined,
    );
    const server = resolveServer(
      ctx,
      url.searchParams.get("server") ?? undefined,
    );
    const check = validateMailUsername(url.searchParams.get("u") ?? "");
    if (!check.ok) {
      return json({
        available: false,
        username: check.username,
        reason: check.reason,
      });
    }
    const res = await fetch(
      apiUrl(
        server,
        `/api/v1/mail/username-available?u=${
          encodeURIComponent(check.username)
        }`,
      ),
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        `username check failed: ${payload?.error ?? `HTTP ${res.status}`}`,
      );
    }
    return json(payload);
  }

  if (
    req.method === "GET" && url.pathname === "/api/v1/mail/ebp-payment/config"
  ) {
    const ctx = await getContext(
      url.searchParams.get("home") ?? undefined,
      url.searchParams.get("identity") ?? undefined,
    );
    const server = resolveServer(
      ctx,
      url.searchParams.get("server") ?? undefined,
    );
    const res = await fetch(apiUrl(server, "/api/v1/mail/payment/config"));
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        "payment configuration unavailable",
      );
    }
    return json(await res.json());
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/mail/ebp-payment/recover"
  ) {
    const body = await readJson<
      {
        home?: unknown;
        identity?: unknown;
        password?: unknown;
        username?: unknown;
        server?: unknown;
        forCancellation?: unknown;
        domain?: unknown;
      }
    >(req);
    if (typeof body.password !== "string" || !body.password) {
      throw new HttpError(STATUS.BadRequest, "password is required");
    }
    const check = validateMailUsername(
      typeof body.username === "string" ? body.username : "",
    );
    if (!check.ok) throw new HttpError(STATUS.BadRequest, check.reason);
    const ctx = await getContext(
      typeof body.home === "string" ? body.home : undefined,
      typeof body.identity === "string" ? body.identity : undefined,
    );
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    const mode = body.domain === "test.pqpost.com" ? "test" : undefined;
    const config = await fetchEbpMailConfig(server, mode);
    if (!config.enabled || !config.domain) {
      throw new HttpError(STATUS.ServiceUnavailable, "mail signup unavailable");
    }
    if (body.forCancellation !== true && !checkoutOriginForServer(config.domain, server)) {
      throw new HttpError(
        STATUS.ServiceUnavailable,
        "checkout is not configured for this key server",
      );
    }
    const { identity, result: proof } = await mutateIdentityForRequest(
      ctx,
      body.password,
      (current) => {
        current.attachDetail(
          MAIL_PAYMENT_RECOVER_PATH,
          `${check.username}@${config.domain}`,
        );
        const signedProof = current.details.get(MAIL_PAYMENT_RECOVER_PATH)?.[1];
        current.details.delete(MAIL_PAYMENT_RECOVER_PATH);
        return signedProof;
      },
    );
    const res = await fetch(apiUrl(server, "/api/v1/mail/payment/recover"), {
      method: "POST",
      headers: { "content-type": "application/json", ...(mode ? {"x-ebp-mail-mode": mode} : {}) },
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        username: check.username,
        proof,
        forCancellation: body.forCancellation === true,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        typeof result.error === "string" ? result.error : `HTTP ${res.status}`,
      );
    }
    return json(result);
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/mail/ebp-payment/order"
  ) {
    const body = await readJson<
      {
        home?: unknown;
        identity?: unknown;
        password?: unknown;
        username?: unknown;
        server?: unknown;
        network?: unknown;
        asset?: unknown;
      }
    >(req);
    if (
      typeof body.password !== "string" || !body.password ||
      typeof body.network !== "string" || typeof body.asset !== "string"
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "password, network, and asset are required",
      );
    }
    const check = validateMailUsername(
      typeof body.username === "string" ? body.username : "",
    );
    if (!check.ok) throw new HttpError(STATUS.BadRequest, check.reason);
    const ctx = await getContext(
      typeof body.home === "string" ? body.home : undefined,
      typeof body.identity === "string" ? body.identity : undefined,
    );
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    const config = await fetchEbpMailConfig(server);
    if (!config.enabled || !config.domain) {
      throw new HttpError(STATUS.ServiceUnavailable, "mail signup unavailable");
    }
    const checkoutOrigin = checkoutOriginForServer(config.domain, server);
    if (!checkoutOrigin) {
      throw new HttpError(
        STATUS.ServiceUnavailable,
        "checkout is not configured for this key server",
      );
    }
    const network = body.network;
    const asset = body.asset;
    const { identity, result: proof } = await mutateIdentityForRequest(
      ctx,
      body.password,
      (current) => {
        current.attachDetail(
          MAIL_PAYMENT_ORDER_PATH,
          buildMailPaymentOrderDetail(
            `${check.username}@${config.domain}`,
            network,
            asset,
          ),
        );
        const signedProof = current.details.get(MAIL_PAYMENT_ORDER_PATH)?.[1];
        current.details.delete(MAIL_PAYMENT_ORDER_PATH);
        return signedProof;
      },
    );
    const res = await fetch(apiUrl(server, "/api/v1/mail/payment/order"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        username: check.username,
        network: body.network,
        asset: body.asset,
        proof,
      }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        typeof result.error === "string" ? result.error : `HTTP ${res.status}`,
      );
    }
    if (typeof result.orderId !== "string") {
      throw new HttpError(STATUS.BadGateway, "invalid checkout response");
    }
    return json({
      orderId: result.orderId,
      checkoutUrl: `${checkoutOrigin}/checkout.html#${result.orderId}`,
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/mail/ebp-payment/status"
  ) {
    const body = await readJson<
      {
        home?: unknown;
        orderId?: unknown;
        identity?: unknown;
        server?: unknown;
      }
    >(req);
    const ctx = await getContext(
      typeof body.home === "string" ? body.home : undefined,
      typeof body.identity === "string" ? body.identity : undefined,
    );
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    const res = await fetch(apiUrl(server, "/api/v1/mail/payment/status"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: body.orderId }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        typeof result.error === "string" ? result.error : `HTTP ${res.status}`,
      );
    }
    return json(result);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/mail/ebp-signup") {
    const body = await readJson<{
      home?: unknown;
      identity?: unknown;
      password?: unknown;
      username?: unknown;
      server?: unknown;
      fromName?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const password = typeof body.password === "string" ? body.password : "";
    if (!password) {
      throw new HttpError(STATUS.BadRequest, "password is required");
    }
    const check = validateMailUsername(
      typeof body.username === "string" ? body.username : "",
    );
    if (!check.ok) throw new HttpError(STATUS.BadRequest, check.reason);

    const ctx = await getContext(home, identityName);
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    await unlockIdentity(ctx, password);
    if ((await getMailSecretsStatus(ctx.identityDir)).locked) {
      throw new HttpError(
        STATUS.Conflict,
        "Stored mail credentials could not be unlocked with the identity password",
      );
    }

    const config = await fetchEbpMailConfig(server);
    if (!config.enabled || !config.domain || !config.imap || !config.smtp) {
      throw new HttpError(
        STATUS.ServiceUnavailable,
        "this key server does not offer EBP email sign-up",
      );
    }
    const email = `${check.username}@${config.domain}`;
    const mailPassword = randomHex(16);
    const { identity, result } = await mutateIdentityForRequest(
      ctx,
      undefined,
      async (current) => {
        current.attachDetail("email", email);
        const entry = current.details.get("email");
        if (!entry) {
          throw new HttpError(
            STATUS.InternalServerError,
            "failed to sign email detail",
          );
        }

        const res = await fetch(apiUrl(server, "/api/v1/mail/signup"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fingerprint: current.toFingerprint(),
            username: check.username,
            mailPassword,
            detailProof: entry[1],
          }),
        });
        const signupResult = await res.json().catch(() => ({})) as Record<
          string,
          unknown
        >;
        if (!res.ok) {
          const reason = typeof signupResult.error === "string"
            ? signupResult.error
            : `HTTP ${res.status}`;
          throw new HttpError(
            res.status === 409 ? STATUS.Conflict : STATUS.BadGateway,
            reason,
          );
        }
        return signupResult;
      },
    );

    const imap = result.imap as MailEndpoint;
    const smtp = result.smtp as MailEndpoint;
    const login = typeof result.login === "string" ? result.login : email;
    const { accountId, accountConfig } = await saveEbpMailAccount(
      ctx.identityDir,
      {
        email,
        login,
        imap,
        smtp,
        fromName: toSafeString(body.fromName, 128),
      },
    );
    const secretStore = await getMailSecretsStore(ctx.identityDir);
    secretStore[accountId] = {
      imapPassword: mailPassword,
      smtpPassword: mailPassword,
    };
    await saveMailSecretsStore(ctx.identityDir, secretStore);

    return json({
      ok: true,
      email,
      fingerprint: identity.toFingerprint(),
      accountId,
      account: accountConfig,
      connection: { imap, smtp, login, password: mailPassword },
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/mail/ebp-reset-password"
  ) {
    const body = await readJson<{
      home?: unknown;
      identity?: unknown;
      password?: unknown;
      server?: unknown;
      accountId?: unknown;
      fromName?: unknown;
      expectedEmail?: unknown;
    }>(req);
    const password = typeof body.password === "string" && body.password
      ? body.password
      : undefined;
    const ctx = await getContext(
      typeof body.home === "string" ? body.home : undefined,
      typeof body.identity === "string" ? body.identity : undefined,
    );
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    // The reset proof is never saved, so the loaded identity is not persisted.
    const identity = await loadIdentityForRequest(ctx, password);
    const expectedEmail = toSafeString(body.expectedEmail, 320).toLowerCase();
    const mode = expectedEmail.endsWith("@test.pqpost.com") ? "test" : undefined;
    const config = await fetchEbpMailConfig(server, mode);
    if (!config.enabled || !config.domain) {
      throw new HttpError(
        STATUS.ServiceUnavailable,
        "this key server does not offer EBP email",
      );
    }
    if (expectedEmail && !expectedEmail.endsWith(`@${config.domain}`)) {
      throw new HttpError(STATUS.Conflict, "The mailbox does not match this setup domain.");
    }
    const email = expectedEmail || await resolveManagedEmail(identity, server, config.domain);
    const mailPassword = randomHex(16);
    identity.attachDetail(
      MAIL_PASSWORD_RESET_PATH,
      buildMailPasswordResetDetail(email, sha256Hex(mailPassword)),
    );
    const proof = identity.details.get(MAIL_PASSWORD_RESET_PATH)?.[1];
    const res = await fetch(apiUrl(server, "/api/v1/mail/reset-password"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fingerprint: identity.toFingerprint(),
        mailPassword,
        proof,
      }),
    });
    const result = await res.json().catch(() => ({})) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      throw new HttpError(
        res.status === 404 ? STATUS.NotFound : STATUS.BadGateway,
        typeof result.error === "string" ? result.error : `HTTP ${res.status}`,
      );
    }
    const imap = (result.imap ?? config.imap) as MailEndpoint | undefined;
    const smtp = (result.smtp ?? config.smtp) as MailEndpoint | undefined;
    const store = await getMailStore(ctx.identityDir);
    const requestedId = toSafeString(body.accountId, 128);
    let account = store.accounts.find((a) =>
      requestedId
        ? a.id === requestedId
        : a.config.fromEmail.toLowerCase() === email
    );
    let created = false;
    if (!account && !requestedId) {
      if (imap && smtp) {
        const saved = await saveEbpMailAccount(ctx.identityDir, {
          email,
          login: email,
          imap,
          smtp,
          fromName: toSafeString(body.fromName, 128),
        });
        account = (await getMailStore(ctx.identityDir)).accounts.find((a) =>
          a.id === saved.accountId
        );
        created = true;
      }
    }
    let savedLocally = false;
    if (account) {
      try {
        if (mailPinCache.has(ctx.identityDir)) {
          const secretStore = await getMailSecretsStore(ctx.identityDir);
          secretStore[account.id] = {
            imapPassword: mailPassword,
            smtpPassword: mailPassword,
          };
          await saveMailSecretsStore(ctx.identityDir, secretStore);
          savedLocally = true;
        }
      } catch {
        // Mail secrets are locked with a different PIN; caller shows the password.
      }
    }
    return json({
      ok: true,
      email,
      fingerprint: identity.toFingerprint(),
      accountId: account?.id ?? null,
      created,
      savedLocally,
      password: mailPassword,
      connection: { imap, smtp, login: email, password: mailPassword },
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/mail/ebp-delete") {
    const body = await readJson<{
      home?: unknown;
      identity?: unknown;
      password?: unknown;
      server?: unknown;
      confirm?: unknown;
    }>(req);
    const password = typeof body.password === "string" && body.password
      ? body.password
      : undefined;
    const ctx = await getContext(
      typeof body.home === "string" ? body.home : undefined,
      typeof body.identity === "string" ? body.identity : undefined,
    );
    const server = resolveServer(
      ctx,
      typeof body.server === "string" ? body.server : undefined,
    );
    const identity = await loadIdentityForRequest(ctx, password);
    const config = await fetchEbpMailConfig(server);
    if (!config.enabled || !config.domain) {
      throw new HttpError(
        STATUS.ServiceUnavailable,
        "this key server does not offer EBP email",
      );
    }
    const email = await resolveManagedEmail(identity, server, config.domain);
    const confirm = typeof body.confirm === "string"
      ? body.confirm.trim().toLowerCase()
      : "";
    if (confirm !== email) {
      throw new HttpError(STATUS.BadRequest, `type ${email} to confirm`);
    }
    const signer = await loadIdentityForRequest(ctx, password);
    signer.attachDetail(MAIL_DELETE_PATH, buildMailDeleteDetail(email));
    const proof = signer.details.get(MAIL_DELETE_PATH)?.[1];
    const res = await fetch(apiUrl(server, "/api/v1/mail/delete"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fingerprint: identity.toFingerprint(), proof }),
    });
    const result = await res.json().catch(() => ({})) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      throw new HttpError(
        res.status === 404 ? STATUS.NotFound : STATUS.BadGateway,
        typeof result.error === "string" ? result.error : `HTTP ${res.status}`,
      );
    }

    const store = await getMailStore(ctx.identityDir);
    const removedIds = store.accounts
      .filter((a) => a.config.fromEmail.toLowerCase() === email)
      .map((a) => a.id);
    if (removedIds.length) {
      store.accounts = store.accounts.filter((a) => !removedIds.includes(a.id));
      if (
        store.selectedAccountId && removedIds.includes(store.selectedAccountId)
      ) {
        store.selectedAccountId = store.accounts[0]?.id ?? null;
      }
      await saveMailStore(ctx.identityDir, store);
    }
    let secretsCleared = removedIds.length === 0;
    try {
      const status = await getMailSecretsStatus(ctx.identityDir);
      if (!status.locked) {
        const secretStore = await getMailSecretsStore(ctx.identityDir);
        for (const id of removedIds) delete secretStore[id];
        await saveMailSecretsStore(ctx.identityDir, secretStore);
        secretsCleared = true;
      }
    } catch {
      // Orphaned secrets stay encrypted and unused until the PIN is entered.
    }
    let detailRemoved = false;
    if (identity.getDetail("email")?.toLowerCase() === email) {
      try {
        const mutation = await mutateIdentityForRequest(
          ctx,
          password,
          (current) => {
            if (
              current.getDetail("email")?.toLowerCase() !== email
            ) return false;
            current.details.delete("email");
            return true;
          },
        );
        detailRemoved = mutation.result;
      } catch {
        // The server copy is already revoked; the stale local detail is harmless.
      }
    }
    return json({
      ok: true,
      email,
      removedAccountIds: removedIds,
      selectedAccountId: store.selectedAccountId,
      secretsCleared,
      detailRemoved,
    });
  }

  return null;
}
