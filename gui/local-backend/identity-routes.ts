import {identityIsPublished} from "../../common/Discovery.ts";
import { writePrivateFileAtomic } from "../../cli/atomic-file.ts";
import { Identity } from "../../core/Identity.ts";
import { validatePassword } from "../../common/PasswordPolicy.ts";
import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "../../core/Mnemonic.ts";
import {
  apiUrl,
  ensurePrivateDir,
  getContext,
  listIdentityNames,
  readState,
  updateState,
} from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { loadIdentityPublic, saveIdentity } from "./identity.ts";
import {
  getUnlockStatus,
  loadIdentityForRequest,
  lockAll,
  lockIdentity,
  setUnlockTimeout,
  unlockIdentity,
} from "./unlock-session.ts";
import {
  nextHdIdentityIndex,
  parseHdChange,
  parseHdProfile,
  parseNonNegativeInteger,
} from "./route-support.ts";

export async function handleIdentityRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/v1/identities") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const names = await listIdentityNames(ctx.identityDir);
    const currentState = await readState(ctx.identityDir);
    const server = currentState?.server ?? null;

    const identitiesWithFingerprints = await Promise.all(
      names.map(async (name) => {
        const identityCtx = await getContext(home ?? undefined, name);
        const publicData = await loadIdentityPublic(identityCtx);
        const fingerprint = publicData?.fingerprint ?? null;

        let publishedToServer = false;
        if (fingerprint && server) {
          try {
            const res = await fetch(
              apiUrl(server, `/api/v1/identity/${fingerprint}`),
            );
            publishedToServer = res.ok;
          } catch {
            // Server unreachable, assume not published
          }
        }

        return {
          name,
          fingerprint,
          publishedToServer,
        };
      }),
    );

    return json({
      identities: identitiesWithFingerprints,
      currentIdentity: currentState?.currentIdentity ?? ctx.currentIdentity,
    });
  }

  // Get public info for current identity (no password required)
  if (req.method === "GET" && url.pathname === "/api/v1/identity/public") {
    const home = url.searchParams.get("home") ?? undefined;
    const identityName = url.searchParams.get("identity") ?? undefined;
    const ctx = await getContext(home ?? undefined, identityName);
    const publicData = await loadIdentityPublic(ctx);
    if (!publicData) {
      return json({ available: false });
    }
    // Convert details from {path: [detail, proof]} to [{path, detail}]
    const detailsArray = Object.entries(publicData.details ?? {}).map((
      [path, val],
    ) => ({
      path,
      detail: Array.isArray(val) ? val[0] : val,
    }));
    // Get revoked details
    const revokedDetailPaths = Object.keys(publicData.revokedDetails ?? {});
    return json({
      available: true,
      fingerprint: publicData.fingerprint,
      signingKeyType: publicData.signingKeyType,
      encryptionKeyType: publicData.encryptionKeyType,
      signingKeyDetails: publicData.signingKeyDetails,
      encryptionKeyDetails: publicData.encryptionKeyDetails,
      details: detailsArray,
      revoked: !!publicData.revocationCertificate,
      revokedDetails: revokedDetailPaths,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hd/mnemonic") {
    const body = await readJson<{ strength?: unknown }>(req);
    const strength = parseNonNegativeInteger(body.strength, 256);
    return json({ mnemonic: generateMnemonic(strength) }, STATUS.Created);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hd/verify") {
    const body = await readJson<{ mnemonic?: unknown }>(req);
    const mnemonic = typeof body.mnemonic === "string" ? body.mnemonic : "";
    return json({ valid: validateMnemonic(mnemonic) });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hd/identity") {
    const body = await readJson<{
      name?: unknown;
      mnemonic?: unknown;
      passphrase?: unknown;
      password?: unknown;
      profile?: unknown;
      account?: unknown;
      change?: unknown;
      index?: unknown;
      force?: unknown;
      enforcePasswordPolicy?: unknown;
      home?: unknown;
    }>(req);
    const name = typeof body.name === "string" && body.name.length > 0
      ? body.name
      : undefined;
    const mnemonic = typeof body.mnemonic === "string" ? body.mnemonic : "";
    const password = typeof body.password === "string" ? body.password : "";
    const enforcePasswordPolicy = body.enforcePasswordPolicy !== false;
    const home = typeof body.home === "string" ? body.home : undefined;
    if (!name) throw new HttpError(STATUS.BadRequest, "name is required");
    if (!validateMnemonic(mnemonic)) {
      throw new HttpError(STATUS.BadRequest, "valid mnemonic is required");
    }
    if (!password) {
      throw new HttpError(STATUS.BadRequest, "password is required");
    }
    const passwordCheck = validatePassword(password, {
      enforcePolicy: enforcePasswordPolicy,
    });
    if (!passwordCheck.ok) {
      throw new HttpError(STATUS.BadRequest, passwordCheck.reason, {
        suggestions: passwordCheck.suggestions,
        strength: passwordCheck.strength,
      });
    }

    const ctx = await getContext(home, name);
    try {
      await Deno.stat(ctx.identityPath);
      if (!body.force) {
        throw new HttpError(
          STATUS.Conflict,
          "identity already exists; pass force to overwrite",
        );
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    const seed = mnemonicToSeed(
      mnemonic,
      typeof body.passphrase === "string" ? body.passphrase : "",
    );
    const profile = parseHdProfile(body.profile);
    const account = parseNonNegativeInteger(body.account, 0);
    const change = parseHdChange(body.change);
    const index = body.index === undefined
      ? await nextHdIdentityIndex(ctx, seed, profile, account, change)
      : parseNonNegativeInteger(body.index, 0);
    const identity = Identity.fromAccount(seed, {
      profile,
      account,
      change,
      index,
    });

    await ensurePrivateDir(ctx.identityDir);
    await ensurePrivateDir(ctx.contactsDir);
    await saveIdentity(ctx, password, identity);
    await updateState(ctx.identityDir, {
      currentIdentity: ctx.currentIdentity,
    });

    return json({
      ok: true,
      identity: {
        name: ctx.currentIdentity,
        fingerprint: identity.toFingerprint(),
        signingKeyType: identity.signingKeyType,
        encryptionKeyType: identity.encryptionKeyType,
        hdProvenance: identity.hdProvenance,
        identityPath: ctx.identityPath,
      },
    }, STATUS.Created);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hd/discover") {
    const body = await readJson<{
      mnemonic?: unknown;
      passphrase?: unknown;
      profile?: unknown;
      account?: unknown;
      gapLimit?: unknown;
      server?: unknown;
      home?: unknown;
    }>(req);
    const mnemonic = typeof body.mnemonic === "string" ? body.mnemonic : "";
    if (!validateMnemonic(mnemonic)) {
      throw new HttpError(STATUS.BadRequest, "valid mnemonic is required");
    }
    const home = typeof body.home === "string" ? body.home : undefined;
    const ctx = await getContext(home);
    const seed = mnemonicToSeed(
      mnemonic,
      typeof body.passphrase === "string" ? body.passphrase : "",
    );
    const profile = parseHdProfile(body.profile);
    const account = parseNonNegativeInteger(body.account, 0);
    const gapLimit = parseNonNegativeInteger(body.gapLimit, 20);
    const server = typeof body.server === "string"
      ? body.server
      : (await readState(ctx.identityDir))?.server;
    const localFingerprints = new Map<string, string>();
    for (const identityName of await listIdentityNames(ctx.identityDir)) {
      const identityCtx = await getContext(home, identityName);
      const publicData = await loadIdentityPublic(identityCtx);
      if (publicData?.fingerprint) {
        localFingerprints.set(publicData.fingerprint, identityName);
      }
    }

    const matches: unknown[] = [];
    let gap = 0;
    for (let index = 0; gap < gapLimit; index++) {
      const identity = Identity.fromAccount(seed, {
        profile,
        account,
        change: "external",
        index,
      });
      const fingerprint = identity.toFingerprint();
      const localName = localFingerprints.get(fingerprint);
      let publishedToServer = false;
      if (server) {
        try {
          const res = await fetch(
            apiUrl(server, `/api/v1/identity/${fingerprint}`),
          );
          publishedToServer = await identityIsPublished(res);
        } catch (error) { throw new HttpError(STATUS.ServiceUnavailable, `Discovery incomplete: ${String(error)}`); }
      }
      if (localName || publishedToServer) {
        gap = 0;
        matches.push({ index, fingerprint, localName, publishedToServer });
      } else {
        gap++;
      }
    }
    return json({ matches, gapLimit });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/generate") {
    const body = await readJson<{
      name?: unknown;
      signingType?: unknown;
      encryptionType?: unknown;
      password?: unknown;
      force?: unknown;
      enforcePasswordPolicy?: unknown;
      home?: unknown;
    }>(req);

    const name = typeof body.name === "string" && body.name.length > 0
      ? body.name
      : undefined;
    const signingType = typeof body.signingType === "string"
      ? body.signingType
      : "dilithium";
    const encryptionType = typeof body.encryptionType === "string"
      ? body.encryptionType
      : "kyber";
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const enforcePasswordPolicy = body.enforcePasswordPolicy !== false;
    const force = Boolean(body.force);
    const home = typeof body.home === "string" ? body.home : undefined;

    const ctx = await getContext(home, name);

    if (!password) {
      throw new HttpError(
        STATUS.BadRequest,
        "password is required",
      );
    }
    const passwordCheck = validatePassword(password, {
      enforcePolicy: enforcePasswordPolicy,
    });
    if (!passwordCheck.ok) {
      throw new HttpError(
        STATUS.BadRequest,
        passwordCheck.reason,
        {
          suggestions: passwordCheck.suggestions,
          strength: passwordCheck.strength,
        },
      );
    }

    if (!["dilithium", "sphincs"].includes(signingType)) {
      throw new HttpError(
        STATUS.BadRequest,
        "invalid signing type (dilithium|sphincs)",
      );
    }
    if (encryptionType !== "kyber") {
      throw new HttpError(
        STATUS.BadRequest,
        "invalid encryption type (only kyber supported)",
      );
    }

    try {
      await Deno.stat(ctx.identityPath);
      if (!force) {
        throw new HttpError(
          STATUS.Conflict,
          "identity already exists; pass force to overwrite",
        );
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }

    const identity = new Identity(
      signingType as "dilithium" | "sphincs",
      encryptionType as "kyber",
    );

    await ensurePrivateDir(ctx.identityDir);
    await ensurePrivateDir(ctx.contactsDir);
    await saveIdentity(ctx, password, identity);
    await updateState(ctx.identityDir, {
      currentIdentity: ctx.currentIdentity,
    });

    return json({
      ok: true,
      identity: {
        name: ctx.currentIdentity,
        fingerprint: identity.toFingerprint(),
        signingKeyType: identity.signingKeyType,
        encryptionKeyType: identity.encryptionKeyType,
        identityPath: ctx.identityPath,
      },
    }, STATUS.Created);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/use") {
    const body = await readJson<{ name?: unknown; home?: unknown }>(req);
    const name = typeof body.name === "string" ? body.name : undefined;
    const home = typeof body.home === "string" ? body.home : undefined;
    if (!name) throw new HttpError(STATUS.BadRequest, "name is required");

    const ctx = await getContext(home, name);
    try {
      await Deno.stat(ctx.identityPath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new HttpError(STATUS.NotFound, "identity not found");
      }
      throw e;
    }

    await updateState(ctx.identityDir, { currentIdentity: name });
    return json({ ok: true, currentIdentity: name });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/unlock") {
    const body = await readJson<{
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      timeoutMinutes?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const password = typeof body.password === "string" ? body.password : "";
    const ctx = await getContext(home, identityName);
    const { identity, status, mailUnlocked } = await unlockIdentity(
      ctx,
      password,
      body.timeoutMinutes,
    );
    return json({
      ok: true,
      ...status,
      fingerprint: identity.toFingerprint(),
      mailSecretsUnlocked: mailUnlocked,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/lock") {
    const body = await readJson<
      { home?: unknown; identity?: unknown; all?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const ctx = await getContext(home, identityName);
    const lockedCurrent = lockIdentity(ctx);
    const lockedOthers = body.all === true ? lockAll() : 0;
    return json({
      ok: true,
      locked: lockedCurrent || lockedOthers > 0,
      ...getUnlockStatus(ctx),
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/identity/unlock-timeout"
  ) {
    const body = await readJson<
      { home?: unknown; identity?: unknown; timeoutMinutes?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const ctx = await getContext(home, identityName);
    return json(setUnlockTimeout(ctx, body.timeoutMinutes));
  }

  if (
    req.method === "GET" && url.pathname === "/api/v1/identity/unlock-status"
  ) {
    const home = url.searchParams.get("home") ?? undefined;
    const identityName = url.searchParams.get("identity") ?? undefined;
    const ctx = await getContext(home, identityName);
    return json(getUnlockStatus(ctx));
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/info") {
    const body = await readJson<
      { password?: unknown; home?: unknown; identity?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    return json({
      fingerprint: identity.toFingerprint(),
      signingKeyType: identity.signingKeyType,
      encryptionKeyType: identity.encryptionKeyType,
      details: Array.from(identity.details.entries()).map((
        [path, [detail]],
      ) => ({ path, detail })),
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/identity/export-public"
  ) {
    const body = await readJson<
      {
        password?: unknown;
        home?: unknown;
        identity?: unknown;
        includeSigningKey?: unknown;
        includeEncryptionKey?: unknown;
        includeDetails?: unknown;
      }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    const includeSigningKey = body.includeSigningKey !== false;
    const includeEncryptionKey = body.includeEncryptionKey !== false;
    const includeDetails = body.includeDetails === true;
    if (!includeSigningKey && !includeEncryptionKey) {
      throw new HttpError(
        STATUS.BadRequest,
        "export must include at least one public key",
      );
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    return json(identity.toPublicExport({
      includeSigningKey,
      includeEncryptionKey,
      includeDetails,
    }));
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/identity/export-file"
  ) {
    const body = await readJson<{
      name?: unknown;
      home?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : undefined;
    const ctx = await getContext(home, name);
    let storageData: string;
    try {
      storageData = await Deno.readTextFile(ctx.identityPath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new HttpError(STATUS.NotFound, "identity not found");
      }
      throw e;
    }
    return json({
      ok: true,
      name: ctx.currentIdentity,
      filename: `${ctx.currentIdentity}.identity.json`,
      content: storageData,
    });
  }

  if (
    req.method === "POST" && url.pathname === "/api/v1/identity/import-file"
  ) {
    const body = await readJson<{
      content?: unknown;
      name?: unknown;
      force?: unknown;
      home?: unknown;
      setCurrent?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) {
      throw new HttpError(
        STATUS.BadRequest,
        "identity file content is required",
      );
    }
    const publicData = Identity.readPublicData(content);
    if (!publicData?.fingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "invalid identity file: missing public data",
      );
    }
    const name = typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : publicData.fingerprint.slice(0, 16);
    const force = Boolean(body.force);
    const setCurrent = body.setCurrent !== false;
    const ctx = await getContext(home, name);
    try {
      await Deno.stat(ctx.identityPath);
      if (!force) {
        throw new HttpError(
          STATUS.Conflict,
          "identity already exists; pass force to overwrite",
        );
      }
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    await ensurePrivateDir(ctx.identityDir);
    await ensurePrivateDir(ctx.contactsDir);
    await writePrivateFileAtomic(ctx.identityPath, content);
    if (setCurrent) {
      await updateState(ctx.identityDir, { currentIdentity: name });
    }
    return json({
      ok: true,
      identity: {
        name,
        fingerprint: publicData.fingerprint,
        signingKeyType: publicData.signingKeyType,
        encryptionKeyType: publicData.encryptionKeyType,
        identityPath: ctx.identityPath,
      },
    }, STATUS.Created);
  }

  if (req.method === "POST" && url.pathname === "/api/v1/identity/delete") {
    const body = await readJson<{
      name?: unknown;
      home?: unknown;
    }>(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw new HttpError(STATUS.BadRequest, "name is required");
    }
    const ctx = await getContext(home, name);
    try {
      await Deno.remove(ctx.identityPath);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        throw new HttpError(STATUS.NotFound, "identity not found");
      }
      throw e;
    }
    lockIdentity(ctx);
    const state = await readState(ctx.identityDir);
    if (state?.currentIdentity === name) {
      const remaining = (await listIdentityNames(ctx.identityDir)).filter(
        (n) => n !== name,
      );
      await updateState(ctx.identityDir, {
        currentIdentity: remaining[0] ?? "identity",
      });
    }
    return json({ ok: true, deleted: name });
  }

  return null;
}
