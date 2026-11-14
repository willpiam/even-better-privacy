import { assertEquals, assertRejects } from "@std/assert";
import { verifyPaymentTestTarget } from "./pqpost_payment_e2e.ts";

Deno.test("payment live test only accepts the test domain and testnet assets", async () => {
  const paths: string[] = [];
  let domain = "test.pqpost.com";
  let assets = [{ network: "ethereum-sepolia", symbol: "USDC" }, {
    network: "cardano-preview",
    symbol: "ADA",
  }];
  const api = (path: string): Promise<Response> => {
    paths.push(path);
    return Promise.resolve(
      Response.json(
        path.endsWith("signup/config")
          ? {
            enabled: true,
            domain,
            imap: { host: "mail.pqpost.com", port: 993, secure: true },
            smtp: { host: "mail.pqpost.com", port: 465, secure: true },
          }
          : { enabled: true, assets },
      ),
    );
  };
  await verifyPaymentTestTarget(
    api,
    "mail.pqpost.com",
    "ethereum-sepolia",
    "USDC",
  );
  await verifyPaymentTestTarget(
    api,
    "mail.pqpost.com",
    "cardano-preview",
    "ADA",
  );
  await assertRejects(() =>
    verifyPaymentTestTarget(api, "mail.pqpost.com", "ethereum-mainnet", "USDC")
  );
  domain = "pqpost.com";
  await assertRejects(() =>
    verifyPaymentTestTarget(api, "mail.pqpost.com", "ethereum-sepolia", "USDC")
  );
  domain = "test.pqpost.com";
  assets = [{ network: "ethereum-mainnet", symbol: "USDC" }, {
    network: "cardano-preview",
    symbol: "ADA",
  }];
  await assertRejects(() =>
    verifyPaymentTestTarget(api, "mail.pqpost.com", "cardano-preview", "ADA")
  );
  assertEquals(paths.every((path) => path.endsWith("/config")), true);
});

Deno.test("payment live test exercises a short test mailbox and cleans it up", async () => {
  const { runPaymentE2e } = await import("./pqpost_payment_e2e.ts");
  const calls: {
    path: string;
    body: Record<string, unknown>;
    secret: string | null;
  }[] = [];
  let username = "";
  let statusCalls = 0;
  const api = (path: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({
      path,
      body,
      secret: new Headers(init?.headers).get("x-ebp-e2e-secret"),
    });
    if (path.endsWith("signup/config")) {
      return Promise.resolve(
        Response.json({
          enabled: true,
          domain: "test.pqpost.com",
          imap: { host: "mail.pqpost.com", port: 993, secure: true },
          smtp: { host: "mail.pqpost.com", port: 465, secure: true },
        }),
      );
    }
    if (path.endsWith("payment/config")) {
      return Promise.resolve(
        Response.json({
          enabled: true,
          assets: [{ network: "cardano-preview", symbol: "ADA" }],
        }),
      );
    }
    if (path.endsWith("/identity")) {
      return Promise.resolve(Response.json({ ok: true }));
    }
    if (path.endsWith("payment/order")) {
      username = String(body.username);
      return Promise.resolve(
        Response.json({ orderId: "123e4567-e89b-42d3-a456-426614174000" }),
      );
    }
    if (path.endsWith("payment/status")) {
      return Promise.resolve(
        Response.json({
          status: ++statusCalls === 1 ? "pending" : "confirmed",
        }),
      );
    }
    if (path.endsWith("mail/signup")) {
      return Promise.resolve(
        Response.json({ email: `${username}@test.pqpost.com` }),
      );
    }
    if (path.endsWith("e2e/cleanup")) {
      return Promise.resolve(Response.json({ removed: [username] }));
    }
    throw new Error(`Unexpected path ${path}`);
  };
  const identityFactory = () =>
    ({
      payload: {},
      fingerprint: "test-fingerprint",
      signingKey: { variant: "test", sign: () => "test-signature" },
    }) as unknown as ReturnType<
      typeof import("../server/tests/helpers.ts").createIdentityPayload
    >;
  const config = {
    keyServer: "http://127.0.0.1:8789",
    mailHost: "mail.pqpost.com",
    secret: "test-only-e2e-secret",
  };
  await runPaymentE2e(config, "cardano-preview", "ADA", {
    api,
    identityFactory,
    wait: () => Promise.resolve(),
  });
  assertEquals(/^e2e[0-9]{5}$/.test(username), true);
  const order = calls.find((call) => call.path.endsWith("payment/order"))!;
  assertEquals(order.body.network, "cardano-preview");
  assertEquals(order.secret, config.secret);
  const signup = calls.find((call) => call.path.endsWith("mail/signup"))!;
  assertEquals(signup.body.username, username);
  assertEquals(signup.secret, config.secret);
  const cleanup = calls.find((call) => call.path.endsWith("e2e/cleanup"))!;
  assertEquals(cleanup.body.usernames, [username]);
  assertEquals(cleanup.secret, config.secret);
  const before = calls.length;
  await assertRejects(() =>
    runPaymentE2e(
      { ...config, keyServer: "https://ebp-cqyo.onrender.com" },
      "cardano-preview",
      "ADA",
      { api, identityFactory },
    )
  );
  assertEquals(calls.length, before);
});
