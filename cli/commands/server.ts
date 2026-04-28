import { parseArgs } from "@std/cli/parse-args";
import { ExternalIdentity } from "../../core/Identity.ts";
import {
  apiUrl,
  buildStateFromExternal,
  type CLIContext,
  computeStateHash,
  ensurePrivateDir,
  ensureServer,
  loadIdentity,
  normalizeServerUrl,
  stableStringify,
  updateState,
} from "../utils.ts";

export async function cmdPublishIdentity(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const server = ensureServer(ctx, args);
  const { identity } = await loadIdentity(
    ctx,
    args["password"] as string | undefined,
  );
  const summary = identity.summary;

  // Fetch current server state (if any)
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
        signingKeyDetails:
          (body.signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
            { variant: "ml_dsa87" },
        encryptionKeyDetails: (body
          .encryptionKeyDetails as ExternalIdentity[
            "encryptionKeyDetails"
          ]) ?? { variant: "ml_kem1024" },
        details: body.details ?? {},
      };
    } else if (res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      const reason = body?.error ?? `HTTP ${res.status}`;
      console.error(`✗ Failed to query server identity: ${reason}`);
      Deno.exit(1);
    }
  } catch (e) {
    console.error(
      `✗ Failed to query server identity: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    Deno.exit(1);
  }

  // Ensure keys match if identity already exists
  if (serverIdentity) {
    if (
      serverIdentity.signingKey !== summary.signingKey ||
      serverIdentity.encryptionKey !== summary.encryptionKey ||
      serverIdentity.signingKeyType !== summary.signingKeyType ||
      serverIdentity.encryptionKeyType !== summary.encryptionKeyType
    ) {
      console.error(
        "Server identity keys differ from local identity; refusing to publish.",
      );
      Deno.exit(1);
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

  const payload = {
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
    body: JSON.stringify(payload),
  });

  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    const reason = (body as { error?: string } | undefined)?.error ??
      `HTTP ${res.status}`;
    console.error(`✗ Failed to publish identity: ${reason}`);
    Deno.exit(1);
  }

  const fp = (body as { fingerprint?: string } | undefined)?.fingerprint ??
    summary.fingerprint;
  console.log(`✓ Identity published to ${server}`);
  console.log(`  Fingerprint: ${fp}`);
}

export async function cmdFetchIdentity(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const server = ensureServer(ctx, args);
  const fingerprint = args._[0] as string | undefined;
  if (!fingerprint) {
    console.error("Usage: ebp fetch <fingerprint>");
    Deno.exit(1);
  }
  const name = args["name"] as string | undefined;

  const res = await fetch(apiUrl(server, `/api/v1/identity/${fingerprint}`));
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const reason = (body as { error?: string } | undefined)?.error ??
      `HTTP ${res.status}`;
    console.error(`✗ Failed to fetch identity: ${reason}`);
    Deno.exit(1);
  }

  const b = body as {
    fingerprint?: string;
    signingKeyType?: string;
    encryptionKeyType?: string;
    signingKey?: string;
    encryptionKey?: string;
    signingKeyDetails?: unknown;
    encryptionKeyDetails?: unknown;
    details?: Record<string, [string, string]>;
  } | undefined;

  if (b?.fingerprint && b.fingerprint !== fingerprint) {
    console.error(
      "Warning: server fingerprint mismatch; storing as returned value.",
    );
  }

  if (b?.signingKeyType !== "dilithium" && b?.signingKeyType !== "sphincs") {
    console.error("Invalid identity payload from server: signingKeyType");
    Deno.exit(1);
  }
  if (b?.encryptionKeyType !== "kyber") {
    console.error("Invalid identity payload from server: encryptionKeyType");
    Deno.exit(1);
  }

  const external: ExternalIdentity = {
    fingerprint: b?.fingerprint ?? fingerprint,
    signingKeyType: b?.signingKeyType ?? "dilithium",
    encryptionKeyType: b?.encryptionKeyType ?? "kyber",
    signingKey: b?.signingKey ?? "",
    encryptionKey: b?.encryptionKey ?? "",
    signingKeyDetails:
      (b?.signingKeyDetails as ExternalIdentity["signingKeyDetails"]) ??
        { variant: "ml_dsa87" },
    encryptionKeyDetails:
      (b?.encryptionKeyDetails as ExternalIdentity["encryptionKeyDetails"]) ??
        { variant: "ml_kem1024" },
    details: b?.details ?? {},
  };

  if (!external.signingKey || !external.encryptionKey) {
    console.error("Invalid identity payload from server.");
    Deno.exit(1);
  }

  await ensurePrivateDir(ctx.contactsDir);
  const contactName = name ?? external.fingerprint.substring(0, 16);
  const contactPath = `${ctx.contactsDir}/${contactName}.json`;
  try {
    const existingRaw = await Deno.readTextFile(contactPath);
    const existing = JSON.parse(existingRaw) as ExternalIdentity;
    const preservedEntries = Object.entries(
      existing.resolvedOpaqueDetails ?? {},
    ).filter(
      ([path, value]) =>
        typeof value === "string" && external.details[path] !== undefined,
    );
    if (preservedEntries.length > 0) {
      external.resolvedOpaqueDetails = Object.fromEntries(preservedEntries);
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.warn(
        "failed to preserve resolved opaque details during fetch",
        e,
      );
    }
  }
  await Deno.writeTextFile(contactPath, JSON.stringify(external, null, 2), {
    mode: 0o600,
  });

  console.log(`✓ Contact fetched from server ${server}`);
  console.log(`  Stored as: ${contactName}`);
  console.log(`  Fingerprint: ${external.fingerprint}`);
}

export type ServerIdentityEntry = {
  fingerprint: string;
  signingKeyType?: string;
  encryptionKeyType?: string;
  createdAt?: number;
  details?: Record<string, [string, string] | string>;
};

export function asServerEntry(value: unknown): ServerIdentityEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  const fingerprint = typeof obj.fingerprint === "string"
    ? obj.fingerprint
    : undefined;
  if (!fingerprint) return undefined;
  const signingKeyType = typeof obj.signingKeyType === "string"
    ? obj.signingKeyType
    : undefined;
  const encryptionKeyType = typeof obj.encryptionKeyType === "string"
    ? obj.encryptionKeyType
    : undefined;
  const createdAt = typeof obj.createdAt === "number"
    ? obj.createdAt
    : undefined;

  let details: Record<string, [string, string] | string> | undefined;
  if (obj.details && typeof obj.details === "object") {
    details = {};
    for (
      const [k, v] of Object.entries(obj.details as Record<string, unknown>)
    ) {
      if (Array.isArray(v) && typeof v[0] === "string") {
        details[k] = [v[0], typeof v[1] === "string" ? v[1] : ""];
      } else if (typeof v === "string") {
        details[k] = v;
      }
    }
  }

  return { fingerprint, signingKeyType, encryptionKeyType, createdAt, details };
}

export async function cmdListServerIdentities(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const server = ensureServer(ctx, args);
  const page = Math.max(1, parseInt(args["page"] as string, 10) || 1);
  const search = typeof args["search"] === "string"
    ? args["search"].trim()
    : undefined;

  const url = new URL(
    apiUrl(server, search ? "/api/v1/identities/search" : "/api/v1/identities"),
  );
  url.searchParams.set("page", String(page));
  if (search) {
    url.searchParams.set("query", search);
  }

  const res = await fetch(url.toString());
  let body: unknown = {};
  try {
    body = await res.json();
  } catch {
    // ignore parse errors
  }

  if (!res.ok) {
    const reason = (body as { error?: string } | undefined)?.error ??
      `HTTP ${res.status}`;
    console.error(`✗ Failed to list server identities: ${reason}`);
    Deno.exit(1);
  }

  const entriesRaw = (body as { identities?: unknown[] } | undefined)
    ?.identities;
  if (!Array.isArray(entriesRaw)) {
    console.error("Invalid response from server.");
    Deno.exit(1);
  }
  const entries: ServerIdentityEntry[] = entriesRaw.map((v) => asServerEntry(v))
    .filter((v): v is ServerIdentityEntry => !!v);

  // Extract pagination info
  const pagination = (body as {
    pagination?: {
      page?: number;
      totalPages?: number;
      total?: number;
      hasMore?: boolean;
    };
  } | undefined)?.pagination;
  const currentPage = pagination?.page ?? page;
  const totalPages = pagination?.totalPages ?? 1;
  const total = pagination?.total ?? entries.length;

  const searchInfo = search ? ` matching "${search}"` : "";
  console.log(
    `Identities on server ${server}${searchInfo} (page ${currentPage}/${totalPages}, ${total} total):`,
  );
  if (entries.length === 0) {
    console.log("  (none on this page)");
    return;
  }

  const line = "-".repeat(60);
  entries.forEach((entry, idx) => {
    if (idx > 0) console.log(line);
    const fingerprint = entry.fingerprint ?? "(missing)";
    const signing = entry.signingKeyType ?? "?";
    const encryption = entry.encryptionKeyType ?? "?";
    const createdAt = entry.createdAt;
    const created = typeof createdAt === "number"
      ? new Date(createdAt).toISOString()
      : "unknown";

    console.log(`Fingerprint: ${fingerprint}`);
    console.log(`Signing/Encryption: ${signing}/${encryption}`);
    console.log(`Created: ${created}`);

    const details = entry.details ?? {};
    const detailEntries = Object.entries(details);
    console.log("Details:");
    if (detailEntries.length === 0) {
      console.log("  (none)");
    } else {
      console.log("  Path                     | Value");
      console.log(
        "  ------------------------ | --------------------------------",
      );
      for (const [path, value] of detailEntries) {
        const detailValue = Array.isArray(value) ? value[0] : value;
        const safeValue = typeof detailValue === "string"
          ? detailValue
          : JSON.stringify(detailValue);
        const paddedPath = path.length > 24
          ? `${path.slice(0, 21)}...`
          : path.padEnd(24, " ");
        console.log(`  ${paddedPath} | ${safeValue}`);
      }
    }
  });

  if (totalPages > 1) {
    console.log(line);
    console.log(
      `Page ${currentPage} of ${totalPages}. Use --page <n> to view other pages.`,
    );
  }
}

export async function cmdServer(
  args: ReturnType<typeof parseArgs>,
  ctx: CLIContext,
): Promise<void> {
  const newUrl = args._[0] as string | undefined;
  const clear = args["clear"] ?? false;

  if (clear) {
    const state = await updateState(ctx.identityDir, { server: undefined });
    console.log("Server URL cleared.");
    if (state.currentIdentity) {
      console.log(`Current identity remains: ${state.currentIdentity}`);
    }
    return;
  }

  if (!newUrl) {
    if (ctx.server) {
      console.log(`Current server: ${ctx.server}`);
    } else {
      console.log("No server configured. Set one with: ebp server <url>");
    }
    return;
  }

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeServerUrl(newUrl);
  } catch (e) {
    console.error(
      `Invalid server URL: ${e instanceof Error ? e.message : String(e)}`,
    );
    Deno.exit(1);
  }

  await updateState(ctx.identityDir, { server: normalizedUrl });
  console.log(`✓ Server set to: ${normalizedUrl}`);
}
