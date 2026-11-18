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

/** Stalwart explicitly refused the creation. Transport failures have an unknown outcome. */
export class StalwartCreateRejected extends StalwartError {}

type MailboxProvisioning = {
  name: string;
  domain: string;
  password: string;
  quotaBytes: number;
  description: string;
};

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
        body: JSON.stringify({
          using: USING,
          methodCalls: [[method, args, "c1"]],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new StalwartError(
        `mail server unreachable: ${err instanceof Error ? err.message : err}`,
        "unreachable",
      );
    }
    if (!res.ok) {
      throw new StalwartError(
        `mail server returned HTTP ${res.status}`,
        "http",
      );
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
    const name = domain.toLowerCase();
    const cached = this.domainIdCache.get(name);
    if (cached) return cached;

    const hint = this.config.domainId;
    if (hint) {
      const result = await this.call("x:Domain/get", { ids: [hint] });
      const list = (result.list ?? []) as Array<{ id?: string; name?: string }>;
      if (list.some((d) => d.id === hint && d.name?.toLowerCase() === name)) {
        this.domainIdCache.set(name, hint);
        return hint;
      }
    }

    const result = await this.call("x:Domain/get", { ids: null });
    const list = (result.list ?? []) as Array<{ id?: string; name?: string }>;
    const match = list.find((d) => d.name?.toLowerCase() === name);
    if (!match?.id) {
      throw new StalwartError(
        `domain ${domain} not configured in Stalwart`,
        "no_domain",
      );
    }
    this.domainIdCache.set(name, match.id);
    return match.id;
  }

  private async createUser(
    input: MailboxProvisioning,
    domainId: string,
  ): Promise<string> {
    const result = await this.call("x:Account/set", {
      create: {
        new1: {
          "@type": "User",
          name: input.name,
          domainId,
          description: input.description,
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
    if (!err) {
      throw new StalwartError(
        "mail server did not report the creation outcome",
      );
    }
    const type = err?.type ?? "not_created";
    if (type === "alreadyExists" || /exist/i.test(err?.description ?? "")) {
      throw new StalwartCreateRejected(
        "mailbox already exists",
        "already_exists",
      );
    }
    throw new StalwartCreateRejected(
      `mailbox not created: ${err?.description ?? type}`,
      type,
    );
  }

  async createOrRecoverUser(input: MailboxProvisioning): Promise<string> {
    const domainId = await this.resolveDomainId(input.domain);
    let accountId: string;
    try {
      accountId = await this.createUser(input, domainId);
    } catch (error) {
      if (
        error instanceof StalwartCreateRejected &&
        error.code !== "already_exists"
      ) throw error;
      const recoveredId = await this.findOwnedUser(input, domainId);
      if (!recoveredId) throw error;
      // A retry may have generated a different password on the client.
      await this.setPassword(recoveredId, input.password);
      return recoveredId;
    }
    if (!await this.isOwnedUser(accountId, domainId, input)) {
      throw new StalwartError(
        "created account does not match the requested mailbox",
        "mailbox_mismatch",
      );
    }
    return accountId;
  }

  private async findOwnedUser(
    input: MailboxProvisioning,
    domainId: string,
  ): Promise<string | null> {
    const query = await this.call("x:Account/query", {
      filter: {
        operator: "AND",
        conditions: [{ name: input.name }, { domainId }],
      },
      limit: 2,
    });
    if (
      !Array.isArray(query.ids) ||
      query.ids.some((id) => typeof id !== "string")
    ) {
      throw new StalwartError("invalid account lookup response");
    }
    if (!query.ids.length) return null;
    if (query.ids.length !== 1) {
      throw new StalwartError("ambiguous account lookup");
    }
    const [accountId] = query.ids;
    return await this.isOwnedUser(accountId, domainId, input)
      ? accountId
      : null;
  }

  private async isOwnedUser(
    accountId: string,
    domainId: string,
    input: MailboxProvisioning,
  ): Promise<boolean> {
    const result = await this.call("x:Account/get", {
      ids: [accountId],
      properties: ["id", "@type", "name", "domainId", "description"],
    });
    if (!Array.isArray(result.list) || result.list.length !== 1) {
      throw new StalwartError("account disappeared during lookup");
    }
    const [account] = result.list;
    return account?.id === accountId && account["@type"] === "User" &&
      account.name === input.name && account.domainId === domainId &&
      account.description === input.description;
  }

  async setPassword(accountId: string, password: string): Promise<void> {
    const result = await this.call("x:Account/set", {
      update: {
        [accountId]: {
          credentials: { "0": { "@type": "Password", secret: password } },
        },
      },
    });
    const notUpdated = (result.notUpdated ?? {}) as Record<
      string,
      { type?: string }
    >;
    if (notUpdated[accountId]) {
      throw new StalwartError(
        `password not updated: ${notUpdated[accountId].type ?? "unknown"}`,
      );
    }
    if (
      !result.updated || typeof result.updated !== "object" ||
      !Object.hasOwn(result.updated, accountId)
    ) {
      throw new StalwartError(
        "mail server did not confirm the password update",
      );
    }
  }

  async destroyUser(accountId: string): Promise<void> {
    const result = await this.call("x:Account/set", { destroy: [accountId] });
    const notDestroyed = (result.notDestroyed ?? {}) as Record<
      string,
      { type?: string }
    >;
    const err = notDestroyed[accountId];
    if (!err) return;
    const type = err.type ?? "";
    if (type === "notFound" || type === "not_found") return;
    throw new StalwartError(
      `mailbox not destroyed: ${type || "unknown"}`,
      type || "not_destroyed",
    );
  }
}
