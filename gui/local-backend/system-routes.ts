import { PROTOCOL_VERSION } from "../../core/version.ts";
import { COMPONENT_VERSIONS } from "../../app-version.ts";
import { validatePassword } from "../../common/PasswordPolicy.ts";
import { getContext, readState } from "../../cli/utils.ts";
import { json, readJson } from "./http.ts";
import { getCsrfToken } from "./security.ts";

export async function handleSystemRoutes(
  req: Request,
  url: URL,
): Promise<Response | null> {
  if (req.method === "GET" && url.pathname === "/api/v1/health") {
    return json({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
    });
  }

  if (req.method === "GET" && url.pathname === "/api/v1/csrf-token") {
    return json({ token: getCsrfToken() });
  }

  if (req.method === "POST" && url.pathname === "/api/v1/password/check") {
    const body = await readJson<
      { password?: unknown; enforcePasswordPolicy?: unknown }
    >(req);
    return json(validatePassword(
      typeof body.password === "string" ? body.password : "",
      { enforcePolicy: body.enforcePasswordPolicy !== false },
    ));
  }

  if (req.method === "GET" && url.pathname === "/api/v1/context") {
    const home = url.searchParams.get("home") ?? undefined;
    const ctx = await getContext(home ?? undefined);
    const state = await readState(ctx.identityDir);
    return json({
      identityDirLabel: "~/.ebp",
      contactsDirLabel: "~/.ebp/contacts",
      currentIdentity: ctx.currentIdentity,
      server: state?.server ?? null,
      protocolVersion: PROTOCOL_VERSION,
      componentVersion: COMPONENT_VERSIONS.guiLocalBackend,
    });
  }

  return null;
}
