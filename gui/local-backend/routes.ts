import {
  CORS_HEADERS,
  HttpError,
  json,
  STATUS,
  tryServeStatic,
} from "./http.ts";
import { applyCorsHeaders, validateSecurity } from "./security.ts";
import { sweepExpiredSessions } from "./unlock-session.ts";
import { handleSystemRoutes } from "./system-routes.ts";
import { handleMailRoutes } from "./mail-routes.ts";
import { handleIdentityRoutes } from "./identity-routes.ts";
import { handleContactsRoutes } from "./contacts-routes.ts";
import { handleHierarchyRoutes } from "./hierarchy-routes.ts";
import { handleMessageRoutes } from "./message-routes.ts";
import { handleFileRoutes } from "./file-routes.ts";
import { handleManagedMailRoutes } from "./managed-mail-routes.ts";
import { handlePublicationRoutes } from "./publication-routes.ts";
import { handleDirectoryRoutes } from "./directory-routes.ts";
import { handleRevocationRoutes } from "./revocation-routes.ts";
import { handleSystemFilesRoutes } from "./system-files-routes.ts";

const routeHandlers = [
  handleSystemRoutes,
  handleMailRoutes,
  handleIdentityRoutes,
  handleContactsRoutes,
  handleHierarchyRoutes,
  handleMessageRoutes,
  handleFileRoutes,
  handleManagedMailRoutes,
  handlePublicationRoutes,
  handleDirectoryRoutes,
  handleRevocationRoutes,
  handleSystemFilesRoutes,
];

/** Security, static serving, and error translation apply uniformly to every domain. */
export async function handleRequest(req: Request): Promise<Response> {
  const rejected = validateSecurity(req);
  if (rejected) return applyCorsHeaders(req, rejected);
  return applyCorsHeaders(req, await handleRequestInternal(req));
}

async function handleRequestInternal(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  try {
    sweepExpiredSessions();
    const url = new URL(req.url);
    const staticResponse = await tryServeStatic(req, url);
    if (staticResponse) return staticResponse;
    for (const handle of routeHandlers) {
      const response = await handle(req, url);
      if (response) return response;
    }
    return json({ error: "not found" }, STATUS.NotFound);
  } catch (err) {
    if (err instanceof HttpError) {
      return json(
        { error: err.message, details: err.details ?? undefined },
        err.status,
      );
    }
    console.error(err);
    return json({ error: "internal server error" }, STATUS.InternalServerError);
  }
}
