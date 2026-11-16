export function isLoopbackHost(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    hostname.toLowerCase(),
  );
}

/** All callers, including stored preferences and overrides, use this policy. */
export function normalizeServerUrl(server: string): string {
  let url: URL;
  try {
    url = new URL(server.trim());
  } catch {
    throw new Error("server URL must be an absolute URL");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "server URL must not contain credentials, query, or fragment",
    );
  }
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && isLoopbackHost(url.hostname))
  ) {
    throw new Error(
      "server URL must use https:// unless it targets localhost/127.0.0.1",
    );
  }
  return url.toString().replace(/\/+$/, "");
}
