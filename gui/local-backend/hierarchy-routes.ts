import {
  isValidFingerprintBech32,
  shortFingerprint,
} from "../../core/Fingerprint.ts";
import {
  createHierarchyCertificate,
  decodeHierarchyCertificate,
  getHierarchySignaturePayload,
  isHierarchyCertificateExpired,
} from "../../core/HierarchyCertificate.ts";
import { stringToHex } from "../../core/Hex.ts";
import { apiUrl, getContext, stableStringify } from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { loadIdentityPublic, resolveServer } from "./identity.ts";
import { loadIdentityForRequest } from "./unlock-session.ts";
import { listContacts } from "./contacts.ts";
import {
  addPendingHierarchyLocal,
  buildHierarchyTreeFromCertificates,
  decodeHierarchyCertificateDraft,
  fingerprintColor,
  listHierarchyCertificatesLocal,
  readPendingHierarchyLocal,
  storeHierarchyCertificateLocal,
  writePendingHierarchyLocal,
} from "./hierarchy-local.ts";

export async function handleHierarchyRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/create") {
    const body = await readJson<{
      masterFingerprint?: unknown;
      childFingerprint?: unknown;
      expiry?: unknown;
      context?: unknown;
    }>(req);
    const masterFingerprint = typeof body.masterFingerprint === "string"
      ? body.masterFingerprint
      : "";
    const childFingerprint = typeof body.childFingerprint === "string"
      ? body.childFingerprint
      : "";
    const expiry = typeof body.expiry === "number" ? body.expiry : 0;
    const context = typeof body.context === "string" ? body.context : "";
    if (!masterFingerprint || !childFingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "masterFingerprint and childFingerprint are required",
      );
    }
    if (
      !isValidFingerprintBech32(masterFingerprint) ||
      !isValidFingerprintBech32(childFingerprint)
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "fingerprints must be valid bech32",
      );
    }
    const cert = createHierarchyCertificate(
      masterFingerprint,
      childFingerprint,
      { expiry, context },
    );
    return json({
      certificate: stringToHex(JSON.stringify(cert)),
      complete: false,
    });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/propose") {
    const body = await readJson<{
      masterFingerprint?: unknown;
      childFingerprint?: unknown;
      expiry?: unknown;
      context?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      server?: unknown;
    }>(req);
    const masterFingerprint = typeof body.masterFingerprint === "string"
      ? body.masterFingerprint
      : "";
    const childFingerprint = typeof body.childFingerprint === "string"
      ? body.childFingerprint
      : "";
    const expiry = typeof body.expiry === "number" ? body.expiry : 0;
    const context = typeof body.context === "string" ? body.context : "";
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
    if (!masterFingerprint || !childFingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "masterFingerprint and childFingerprint are required",
      );
    }
    if (
      !isValidFingerprintBech32(masterFingerprint) ||
      !isValidFingerprintBech32(childFingerprint)
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "fingerprints must be valid bech32",
      );
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    const proposerFingerprint = identity.toFingerprint();
    if (
      proposerFingerprint !== masterFingerprint &&
      proposerFingerprint !== childFingerprint
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "current identity must be either master or child",
      );
    }
    const cert = createHierarchyCertificate(
      masterFingerprint,
      childFingerprint,
      { expiry, context },
    );
    const payload = getHierarchySignaturePayload(cert);
    const signature = identity.signMessage(payload, undefined, "hierarchy");
    if (proposerFingerprint === masterFingerprint) {
      cert.masterSignature = signature;
    } else {
      cert.childSignature = signature;
    }
    const encoded = stringToHex(JSON.stringify(cert));

    const proposal = await addPendingHierarchyLocal(ctx, {
      masterFingerprint,
      childFingerprint,
      proposerFingerprint,
      certificate: encoded,
      context,
      expiry,
    });
    try {
      const server = resolveServer(ctx, serverOverride);
      const res = await fetch(apiUrl(server, "/api/v1/hierarchy/propose"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposerFingerprint,
          certificate: encoded,
        }),
      });
      if (!res.ok && res.status !== STATUS.NotFound) {
        const responseBody = await res.json().catch(() => ({})) as {
          error?: string;
        };
        throw new HttpError(
          STATUS.BadGateway,
          `failed to propose hierarchy certificate: ${
            responseBody.error ?? `HTTP ${res.status}`
          }`,
        );
      }
    } catch (e) {
      if (e instanceof HttpError) throw e;
      // Offline/temporary server issues should not block proposal creation in local queue.
    }
    return json({ ok: true, certificate: encoded, proposal });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/list") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const entries = await listHierarchyCertificatesLocal(ctx);
    return json({
      relationships: entries.map((entry) => ({
        masterFingerprint: entry.decoded.masterFingerprint,
        childFingerprint: entry.decoded.childFingerprint,
        timestamp: entry.decoded.timestamp,
        expiry: entry.decoded.expiry,
        context: entry.decoded.context,
        certificate: entry.certificate,
        expired: isHierarchyCertificateExpired({
          expiry: entry.decoded.expiry,
        }),
      })),
    });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/tree") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const pub = await loadIdentityPublic(ctx);
    const selfFingerprint = pub?.fingerprint ?? null;
    const entries = await listHierarchyCertificatesLocal(ctx);
    const certs = entries.map((e) => e.decoded);

    const allFingerprints = new Set<string>();
    if (selfFingerprint) allFingerprints.add(selfFingerprint);
    for (const cert of certs) {
      allFingerprints.add(cert.masterFingerprint);
      allFingerprints.add(cert.childFingerprint);
    }

    const contacts = await listContacts(ctx);
    const contactByFingerprint = new Map<
      string,
      { name: string; details: Record<string, [string, string]> }
    >();
    for (const c of contacts) {
      if (c.contact.fingerprint) {
        contactByFingerprint.set(c.contact.fingerprint, {
          name: c.name,
          details: c.contact.details ?? {},
        });
      }
    }

    const selfDetails: Record<string, string> = {};
    if (pub) {
      for (const [path, val] of Object.entries(pub.details ?? {})) {
        selfDetails[path] = Array.isArray(val) ? val[0] : String(val);
      }
    }

    const nodes: Array<{
      fingerprint: string;
      label: string;
      details: Record<string, string>;
      color: string;
      isSelf: boolean;
    }> = [];
    for (const fp of allFingerprints) {
      const isSelf = fp === selfFingerprint;
      let label = shortFingerprint(fp);
      const details: Record<string, string> = {};
      if (isSelf && pub) {
        for (const [k, v] of Object.entries(selfDetails)) {
          details[k] = v;
        }
        if (selfDetails["name"]) label = selfDetails["name"];
      } else {
        const contact = contactByFingerprint.get(fp);
        if (contact) {
          label = contact.name;
          for (const [k, val] of Object.entries(contact.details)) {
            details[k] = Array.isArray(val) ? val[0] : String(val);
          }
        }
      }
      nodes.push({
        fingerprint: fp,
        label,
        details,
        color: fingerprintColor(fp),
        isSelf,
      });
    }

    const relationships = certs.map((cert) => ({
      masterFingerprint: cert.masterFingerprint,
      childFingerprint: cert.childFingerprint,
      context: cert.context,
      timestamp: cert.timestamp,
      expiry: cert.expiry,
      expired: isHierarchyCertificateExpired({ expiry: cert.expiry }),
    }));

    const childToParent = new Map<string, string>();
    for (const cert of certs) {
      childToParent.set(cert.childFingerprint, cert.masterFingerprint);
    }
    const roots: string[] = [];
    for (const fp of allFingerprints) {
      if (!childToParent.has(fp)) {
        roots.push(fp);
      }
    }

    return json({
      focusFingerprint: selfFingerprint,
      nodes,
      relationships,
      roots,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/hierarchy/pending") {
    const home = url.searchParams.get("home") ?? undefined;
    const identityName = url.searchParams.get("identity") ?? undefined;
    const ctx = await getContext(
      home ?? undefined,
      identityName ?? undefined,
    );
    const pub = await loadIdentityPublic(ctx);
    if (!pub?.fingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "current identity fingerprint unavailable",
      );
    }
    const local = await readPendingHierarchyLocal(ctx);
    const proposals = local
      .filter((p) =>
        (p.masterFingerprint === pub.fingerprint ||
          p.childFingerprint === pub.fingerprint) &&
        p.proposerFingerprint !== pub.fingerprint
      )
      .map((p) => ({
        id: p.id,
        masterFingerprint: p.masterFingerprint,
        childFingerprint: p.childFingerprint,
        proposerFingerprint: p.proposerFingerprint,
        certificate: p.certificate,
        context: p.context,
        expiry: p.expiry,
        createdAt: p.createdAt,
      }));
    return json({ fingerprint: pub.fingerprint, proposals });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/accept") {
    const body = await readJson<{
      proposalId?: unknown;
      certificate?: unknown;
      password?: unknown;
      home?: unknown;
      identity?: unknown;
      server?: unknown;
    }>(req);
    const proposalId = Number(body.proposalId);
    const certificate = typeof body.certificate === "string"
      ? body.certificate
      : "";
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
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      throw new HttpError(
        STATUS.BadRequest,
        "proposalId must be a positive integer",
      );
    }
    if (!certificate) {
      throw new HttpError(STATUS.BadRequest, "certificate is required");
    }

    const ctx = await getContext(home, identityName);
    const identity = await loadIdentityForRequest(ctx, password);
    const cert = decodeHierarchyCertificateDraft(certificate);
    const myFingerprint = identity.toFingerprint();
    if (
      myFingerprint !== cert.masterFingerprint &&
      myFingerprint !== cert.childFingerprint
    ) {
      throw new HttpError(
        STATUS.BadRequest,
        "current identity is not part of this certificate",
      );
    }
    const payload = getHierarchySignaturePayload(cert);
    const signature = identity.signMessage(payload, undefined, "hierarchy");
    if (myFingerprint === cert.masterFingerprint) {
      cert.masterSignature = signature;
    }
    if (myFingerprint === cert.childFingerprint) {
      cert.childSignature = signature;
    }
    const signed = stringToHex(JSON.stringify(cert));
    if (!decodeHierarchyCertificate(signed)) {
      throw new HttpError(
        STATUS.BadRequest,
        "accepted certificate must include both signatures",
      );
    }

    const local = await readPendingHierarchyLocal(ctx);
    const proposal = local.find((p) => p.id === proposalId);
    if (!proposal) {
      throw new HttpError(STATUS.NotFound, "pending proposal not found");
    }
    if (proposal.proposerFingerprint === myFingerprint) {
      throw new HttpError(
        STATUS.Forbidden,
        "proposer cannot accept their own pending entry",
      );
    }
    const server = resolveServer(ctx, serverOverride);
    const publishRes = await fetch(apiUrl(server, "/api/v1/hierarchy"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ certificate: signed }),
    });
    const publishBody = await publishRes.json().catch(() => ({})) as {
      error?: string;
    };
    if (!publishRes.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        `failed to publish accepted hierarchy certificate: ${
          publishBody.error ?? `HTTP ${publishRes.status}`
        }`,
      );
    }
    await writePendingHierarchyLocal(
      ctx,
      local.filter((p) => p.id !== proposalId),
    );
    await storeHierarchyCertificateLocal(ctx, signed);
    return json({ ok: true, certificate: signed });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/reject") {
    const body = await readJson<{
      proposalId?: unknown;
      home?: unknown;
      identity?: unknown;
      server?: unknown;
      password?: unknown;
    }>(req);
    const proposalId = Number(body.proposalId);
    const home = typeof body.home === "string" ? body.home : undefined;
    const identityName = typeof body.identity === "string"
      ? body.identity
      : undefined;
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;
    const password = typeof body.password === "string"
      ? body.password
      : undefined;
    if (!Number.isInteger(proposalId) || proposalId <= 0) {
      throw new HttpError(
        STATUS.BadRequest,
        "proposalId must be a positive integer",
      );
    }
    const ctx = await getContext(home, identityName);
    const pub = await loadIdentityPublic(ctx);
    if (!pub?.fingerprint) {
      throw new HttpError(
        STATUS.BadRequest,
        "current identity fingerprint unavailable",
      );
    }
    const local = await readPendingHierarchyLocal(ctx);
    const proposal = local.find((p) => p.id === proposalId);
    if (!proposal) {
      throw new HttpError(STATUS.NotFound, "pending proposal not found");
    }
    if (proposal.proposerFingerprint === pub.fingerprint) {
      throw new HttpError(
        STATUS.Forbidden,
        "proposer cannot reject their own pending entry",
      );
    }
    // F-SERVER-02: the server requires a signature over
    // {action, fingerprint, proposalId, timestamp} from the rejecting
    // identity's signing key, so unlock before touching the local queue.
    const rejectSigner = (serverOverride || ctx.server)
      ? await loadIdentityForRequest(ctx, password)
      : null;
    await writePendingHierarchyLocal(
      ctx,
      local.filter((p) => p.id !== proposalId),
    );
    if (rejectSigner) {
      try {
        const server = resolveServer(ctx, serverOverride);
        const identity = rejectSigner;
        const timestamp = Date.now();
        const rejectMessage = stableStringify({
          action: "hierarchy::reject",
          fingerprint: pub.fingerprint,
          proposalId,
          timestamp,
        });
        const signature = identity.signMessage(rejectMessage);
        await fetch(apiUrl(server, "/api/v1/hierarchy/reject"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            proposalId,
            fingerprint: pub.fingerprint,
            timestamp,
            signature,
          }),
        });
      } catch (err) {
        // propagate password errors, ignore network errors
        if (err instanceof HttpError) throw err;
        // ignore optional remote reject sync failures
      }
    }
    return json({ ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/hierarchy/publish") {
    const body = await readJson<
      { certificate?: unknown; home?: unknown; server?: unknown }
    >(req);
    const certificate = typeof body.certificate === "string"
      ? body.certificate
      : "";
    const home = typeof body.home === "string" ? body.home : undefined;
    const serverOverride = typeof body.server === "string"
      ? body.server
      : undefined;
    if (!certificate) {
      throw new HttpError(STATUS.BadRequest, "certificate is required");
    }
    if (!decodeHierarchyCertificate(certificate)) {
      throw new HttpError(
        STATUS.BadRequest,
        "certificate must include both signatures",
      );
    }
    const ctx = await getContext(home);
    const server = resolveServer(ctx, serverOverride);
    const res = await fetch(apiUrl(server, "/api/v1/hierarchy"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ certificate }),
    });
    const responseBody = await res.json().catch(() => ({})) as {
      error?: string;
    };
    if (!res.ok) {
      throw new HttpError(
        STATUS.BadGateway,
        `failed to publish hierarchy certificate: ${
          responseBody.error ?? `HTTP ${res.status}`
        }`,
      );
    }
    return json({ ok: true });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/v1/hierarchy/")) {
    const fingerprint = decodeURIComponent(
      url.pathname.replace("/api/v1/hierarchy/", ""),
    );
    if (!fingerprint) {
      throw new HttpError(STATUS.BadRequest, "fingerprint is required");
    }
    if (!isValidFingerprintBech32(fingerprint)) {
      throw new HttpError(
        STATUS.BadRequest,
        "fingerprint must be valid bech32",
      );
    }

    const home = url.searchParams.get("home") ?? undefined;
    const serverOverride = url.searchParams.get("server") ?? undefined;
    const source = url.searchParams.get("source") ?? "local";
    const ctx = await getContext(home ?? undefined);

    let treeData: {
      fingerprint: string;
      root: string;
      ancestors: string[];
      descendants: string[];
      allFingerprints: string[];
      relationships: Array<{
        masterFingerprint: string;
        childFingerprint: string;
        timestamp: number;
        expiry: number;
        context: string;
        certificate: string;
        expired: boolean;
      }>;
    };

    if (source === "server") {
      const server = resolveServer(ctx, serverOverride ?? undefined);
      const res = await fetch(
        apiUrl(server, `/api/v1/hierarchy/${fingerprint}`),
      );
      const bodyJson = await res.json().catch(() => ({})) as Record<
        string,
        unknown
      >;
      if (!res.ok) {
        throw new HttpError(
          STATUS.BadGateway,
          `failed to fetch hierarchy: ${
            (bodyJson as { error?: string }).error ?? `HTTP ${res.status}`
          }`,
        );
      }
      treeData = bodyJson as typeof treeData;
    } else {
      const certs = await listHierarchyCertificatesLocal(ctx);
      treeData = buildHierarchyTreeFromCertificates(
        fingerprint,
        certs.map((entry) => entry.decoded),
      );
    }

    const pub = await loadIdentityPublic(ctx);
    const selfFingerprint = pub?.fingerprint ?? null;

    const contacts = await listContacts(ctx);
    const contactByFp = new Map<
      string,
      { name: string; details: Record<string, [string, string]> }
    >();
    for (const c of contacts) {
      if (c.contact.fingerprint) {
        contactByFp.set(c.contact.fingerprint, {
          name: c.name,
          details: (c.contact.details ?? {}) as Record<
            string,
            [string, string]
          >,
        });
      }
    }

    const selfDetails: Record<string, string> = {};
    if (pub) {
      for (const [p, val] of Object.entries(pub.details ?? {})) {
        selfDetails[p] = Array.isArray(val) ? val[0] : String(val);
      }
    }

    const nodes: Array<{
      fingerprint: string;
      label: string;
      details: Record<string, string>;
      color: string;
      isSelf: boolean;
      isFocus: boolean;
    }> = [];

    for (const fp of treeData.allFingerprints) {
      const isSelf = fp === selfFingerprint;
      const isFocus = fp === fingerprint;
      let label = shortFingerprint(fp);
      const details: Record<string, string> = {};
      if (isSelf && pub) {
        for (const [k, v] of Object.entries(selfDetails)) {
          details[k] = v;
        }
        if (selfDetails["name"]) label = selfDetails["name"];
      } else {
        const contact = contactByFp.get(fp);
        if (contact) {
          label = contact.name;
          for (const [k, val] of Object.entries(contact.details)) {
            details[k] = Array.isArray(val) ? val[0] : String(val);
          }
        }
      }
      nodes.push({
        fingerprint: fp,
        label,
        details,
        color: fingerprintColor(fp),
        isSelf,
        isFocus,
      });
    }

    const childSet = new Set(
      treeData.relationships.map((r) => r.childFingerprint),
    );
    const roots: string[] = [];
    for (const fp of treeData.allFingerprints) {
      if (!childSet.has(fp)) roots.push(fp);
    }

    return json({
      ...treeData,
      focusFingerprint: fingerprint,
      nodes,
      roots,
    });
  }

  return null;
}
