// =============================================================================
// Stalwart (v0.16+) management client
// =============================================================================
//
// Accounts are managed over JMAP (`x:Account/*`, `x:Domain/*` under the
// `urn:stalwart:jmap` capability) at `${STALWART_ADMIN_URL}/jmap`. Stalwart
// v0.16 retired the old `/api` management routes; `/api` is now only sign-in
// and schema. List-valued fields such as `credentials` are maps keyed by
// integer strings ("0", "1").

export type StalwartConfig = {
  baseUrl: string;
  token: string;
  domainId: string | null;
};

export type StalwartFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export class StalwartError extends Error {
  constructor(message: string, readonly code: string = "stalwart_error") {
    super(message);
  }
}

const USING = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

export function readStalwartConfig(): StalwartConfig | null {
  const baseUrl = (Deno.env.get("STALWART_ADMIN_URL") ?? "").trim().replace(
    /\/+$/,
    "",
  );
  const token = (Deno.env.get("STALWART_ADMIN_TOKEN") ?? "").trim();
  if (!baseUrl || !token) return null;
  const domainId = (Deno.env.get("STALWART_DOMAIN_ID") ?? "").trim() || null;
  return { baseUrl, token, domainId };
}

type MethodResponse = [string, Record<string, unknown>, string];

export class StalwartClient {
  private domainIdCache = new Map<string, string>();

  constructor(
    private readonly config: StalwartConfig,
    private readonly fetchImpl: StalwartFetch = fetch,
  ) {}

  private async call(
    method: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}/jmap`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ using: USING, methodCalls: [[method, args, "c1"]] }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new StalwartError(
        `mail server unreachable: ${err instanceof Error ? err.message : err}`,
        "unreachable",
      );
    }
    if (!res.ok) {
      throw new StalwartError(`mail server returned HTTP ${res.status}`, "http");
    }
    const body = await res.json() as { methodResponses?: MethodResponse[] };
    const first = body.methodResponses?.[0];
    if (!first) throw new StalwartError("empty JMAP response");
    const [name, result] = first;
    if (name === "error") {
      throw new StalwartError(
        `JMAP error: ${String(result.type ?? "unknown")}`,
        String(result.type ?? "jmap_error"),
      );
    }
    return result;
  }

  async resolveDomainId(domain: string): Promise<string> {
    if (this.config.domainId) return this.config.domainId;
    const cached = this.domainIdCache.get(domain);
    if (cached) return cached;
    const result = await this.call("x:Domain/get", { ids: null });
    const list = (result.list ?? []) as Array<{ id?: string; name?: string }>;
    const match = list.find((d) => d.name?.toLowerCase() === domain.toLowerCase());
    if (!match?.id) {
      throw new StalwartError(`domain ${domain} not configured in Stalwart`, "no_domain");
    }
    this.domainIdCache.set(domain, match.id);
    return match.id;
  }

  async createUser(input: {
    name: string;
    domain: string;
    password: string;
    quotaBytes: number;
    description?: string;
  }): Promise<string> {
    const domainId = await this.resolveDomainId(input.domain);
    const result = await this.call("x:Account/set", {
      create: {
        new1: {
          "@type": "User",
          name: input.name,
          domainId,
          description: input.description ?? null,
          credentials: { "0": { "@type": "Password", secret: input.password } },
          aliases: {},
          memberGroupIds: {},
          roles: { "@type": "User" },
          permissions: { "@type": "Inherit" },
          quotas: { maxDiskQuota: input.quotaBytes },
          encryptionAtRest: { "@type": "Disabled" },
        },
      },
    });
    const created = (result.created ?? {}) as Record<string, { id?: string }>;
    const id = created.new1?.id;
    if (id) return id;
    const notCreated = (result.notCreated ?? {}) as Record<
      string,
      { type?: string; description?: string }
    >;
    const err = notCreated.new1;
    const type = err?.type ?? "not_created";
    if (type === "alreadyExists" || /exist/i.test(err?.description ?? "")) {
      throw new StalwartError("mailbox already exists", "already_exists");
    }
    throw new StalwartError(
      `mailbox not created: ${err?.description ?? type}`,
      type,
    );
  }

  async setPassword(accountId: string, password: string): Promise<void> {
    const result = await this.call("x:Account/set", {
      update: {
        [accountId]: {
          credentials: { "0": { "@type": "Password", secret: password } },
        },
      },
    });
    const notUpdated = (result.notUpdated ?? {}) as Record<string, { type?: string }>;
    if (notUpdated[accountId]) {
      throw new StalwartError(
        `password not updated: ${notUpdated[accountId].type ?? "unknown"}`,
      );
    }
  }

  async destroyUser(accountId: string): Promise<void> {
    const result = await this.call("x:Account/set", { destroy: [accountId] });
    const notDestroyed = (result.notDestroyed ?? {}) as Record<string, { type?: string }>;
    const err = notDestroyed[accountId];
    if (!err) return;
    const type = err.type ?? "";
    if (type === "notFound" || type === "not_found") return;
    throw new StalwartError(`mailbox not destroyed: ${type || "unknown"}`, type || "not_destroyed");
  }
}
