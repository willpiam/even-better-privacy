import { apiUrl, ensureDir, getContext } from "../../cli/utils.ts";
import {
  HttpError,
  json,
  readJson,
  STATUS,
  writeFileExclusive,
} from "./http.ts";
import { resolveServer } from "./identity.ts";

export async function handleSystemFilesRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/v1/server/identities") {
    const home = url.searchParams.get("home") ?? undefined;
    const serverOverride = url.searchParams.get("server") ?? undefined;
    const page = url.searchParams.get("page") ?? undefined;
    const query = url.searchParams.get("query") ??
      url.searchParams.get("q") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const server = resolveServer(ctx, serverOverride ?? undefined);

    const path = query ? "/api/v1/identities/search" : "/api/v1/identities";
    const serverUrl = new URL(apiUrl(server, path));
    serverUrl.searchParams.set("view", "summary");
    if (page) serverUrl.searchParams.set("page", page);
    if (query) serverUrl.searchParams.set("query", query);

    const res = await fetch(serverUrl.toString());
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
        `failed to list server identities: ${reason}`,
      );
    }

    const entriesRaw = (bodyJson as { identities?: unknown[] } | undefined)
      ?.identities;
    if (!Array.isArray(entriesRaw)) {
      throw new HttpError(STATUS.BadGateway, "invalid response from server");
    }

    const entries = entriesRaw
      .map((v) => {
        if (!v || typeof v !== "object") return undefined;
        const obj = v as Record<string, unknown>;
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
        const details = typeof obj.details === "object" && obj.details
          ? obj.details as Record<string, [string, string] | string>
          : {};
        return {
          fingerprint,
          signingKeyType,
          encryptionKeyType,
          createdAt,
          details,
        };
      })
      .filter((v): v is NonNullable<typeof v> => !!v);

    const pagination = (bodyJson as { pagination?: unknown } | undefined)
      ?.pagination;

    return json({ identities: entries, pagination });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/save-file") {
    const body = await readJson<{
      content?: unknown;
      base64Content?: unknown;
      filename?: unknown;
      mimeType?: unknown;
    }>(req);
    const filename = typeof body.filename === "string"
      ? body.filename.trim()
      : "";
    if (!filename) {
      throw new HttpError(STATUS.BadRequest, "filename is required");
    }
    if (/[/\\]/.test(filename) || filename === ".." || filename === ".") {
      throw new HttpError(
        STATUS.BadRequest,
        "filename must not contain path separators",
      );
    }
    const home = Deno.env.get("HOME") || Deno.env.get("USERPROFILE") || "";
    if (!home) {
      throw new HttpError(
        STATUS.InternalServerError,
        "could not determine home directory",
      );
    }
    const downloadsDir = `${home}/Downloads`;
    await ensureDir(downloadsDir);
    const filePath = `${downloadsDir}/${filename}`;
    if (typeof body.base64Content === "string") {
      const binary = Uint8Array.from(
        atob(body.base64Content),
        (c) => c.charCodeAt(0),
      );
      await writeFileExclusive(filePath, binary);
    } else if (typeof body.content === "string") {
      await writeFileExclusive(
        filePath,
        new TextEncoder().encode(body.content),
      );
    } else {
      throw new HttpError(
        STATUS.BadRequest,
        "content or base64Content is required",
      );
    }
    return json({ ok: true, filename, downloadsRelative: filename });
  }

  return null;
}
