import { discardResponseBody } from "./Discovery.ts";
import { normalizeServerUrl } from "./ServerPolicy.ts";
import {
  matchVerifiedEmailIdentities,
  searchVerifiedEmailIdentity,
  type VerifiedEmailMatch,
} from "./VerifiedEmailMatch.ts";

/** Prefer indexed exact lookup; retain bounded compatibility with older servers. */
export async function lookupVerifiedEmail(
  server: string,
  email: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedEmailMatch> {
  const base = normalizeServerUrl(server);
  const exact = await fetchImpl(
    `${base}/api/v1/identities/by-verified-email?email=${
      encodeURIComponent(email.trim().toLowerCase())
    }`,
  );
  if (exact.status !== 404) {
    if (!exact.ok) {
      throw new Error(`Verified-email lookup failed: HTTP ${exact.status}`);
    }
    const body = await exact.json();
    if (!Array.isArray(body.identities)) {
      throw new Error("Invalid verified-email lookup response");
    }
    return matchVerifiedEmailIdentities(body.identities, email);
  }
  await discardResponseBody(exact);
  return searchVerifiedEmailIdentity(email, async (page, limit) => {
    const url = new URL(`${base}/api/v1/identities/search`);
    for (
      const [key, value] of Object.entries({
        query: email,
        page,
        limit,
        view: "summary",
      })
    ) url.searchParams.set(key, String(value));
    const response = await fetchImpl(url.toString());
    if (!response.ok) {
      throw new Error(`Verified-email search failed: HTTP ${response.status}`);
    }
    const body = await response.json();
    if (!Array.isArray(body.identities)) {
      throw new Error("Invalid identity search response");
    }
    return {
      identities: body.identities,
      hasNextPage: body.pagination?.hasMore === true ||
        body.pagination?.page < body.pagination?.totalPages,
    };
  });
}
