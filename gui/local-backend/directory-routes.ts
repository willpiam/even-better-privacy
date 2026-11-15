import { getContext, readState, updateState } from "../../cli/utils.ts";
import { HttpError, json, readJson, STATUS } from "./http.ts";
import { resolveVerifiedEmailContact } from "./resolve-verified-email.ts";

export async function handleDirectoryRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (
    req.method === "GET" &&
    url.pathname === "/api/v1/contacts/resolve-verified-email"
  ) {
    const home = url.searchParams.get("home") ?? undefined;
    const serverOverride = url.searchParams.get("server") ?? undefined;
    const email = url.searchParams.get("email") ?? "";
    const ctx = await getContext(home);
    return await resolveVerifiedEmailContact(
      ctx,
      email,
      serverOverride ?? undefined,
    );
  }

  if (req.method === "GET" && url.pathname === "/api/v1/server") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const state = await readState(ctx.identityDir);
    return json({ server: state?.server ?? null });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/server") {
    const body = await readJson<
      { url?: unknown; clear?: unknown; home?: unknown }
    >(req);
    const home = typeof body.home === "string" ? body.home : undefined;
    const urlValue = typeof body.url === "string" ? body.url : undefined;
    const clear = Boolean(body.clear);
    const ctx = await getContext(home);

    if (clear) {
      const state = await updateState(ctx.identityDir, { server: undefined });
      return json({ ok: true, server: state.server ?? null });
    }

    if (!urlValue) throw new HttpError(STATUS.BadRequest, "url is required");
    const state = await updateState(ctx.identityDir, { server: urlValue });
    return json({ ok: true, server: state.server ?? null });
  }

  return null;
}
