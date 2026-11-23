import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { handleRequest } from "../routes.ts";
import { initSecurity, setCsrfTokenForTest } from "../security.ts";
import { Identity } from "../../../core/Identity.ts";
import { hexToString } from "../../../core/Hex.ts";

const TEST_TOKEN = "s".repeat(64);
const PASSWORD = "Correct-Horse-Battery-9";
const DOMAIN = "test.pqpost.com";
const MAIL_HOST = "mail.pqpost.com";
const SERVER = "http://127.0.0.1:8789";

type SignupBody = {
  fingerprint: string;
  username: string;
  mailPassword: string;
  detailProof: string;
};

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1:8787${path}`, {
    method,
    headers: {
      host: "127.0.0.1:8787",
      origin: "tauri://localhost",
      "content-type": "application/json",
      "x-ebp-csrf": TEST_TOKEN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withEnv(
  fn: (home: string, signups: SignupBody[], setSignupStatus: (s: number) => void, payments: Record<string, unknown>[]) => Promise<void>,
): Promise<void> {
  const securityHome = await Deno.makeTempDir({ prefix: "ebp-signup-sec-" });
  const home = await Deno.makeTempDir({ prefix: "ebp-signup-home-" });
  const realFetch = globalThis.fetch;
  const signups: SignupBody[] = [];
  const payments: Record<string, unknown>[] = [];
  let signupStatus = 200;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/api/v1/mail/signup/config") {
      return jsonResponse({
        enabled: true,
        domain: DOMAIN,
        imap: { host: MAIL_HOST, port: 993, secure: true },
        smtp: { host: MAIL_HOST, port: 465, secure: true },
      });
    }
    if (url.pathname === "/api/v1/mail/username-available") {
      const u = url.searchParams.get("u");
      return jsonResponse({ available: u !== "taken", username: u });
    }
    if (url.pathname === "/api/v1/mail/payment/recover") {
      payments.push(JSON.parse(String(init?.body)));
      return jsonResponse({ orderId: null });
    }
    if (url.pathname === "/api/v1/mail/payment/order") {
      payments.push(JSON.parse(String(init?.body)));
      return jsonResponse({ orderId: "123e4567-e89b-42d3-a456-426614174000" });
    }
    if (url.pathname === "/api/v1/mail/payment/cancel") {
      payments.push(JSON.parse(String(init?.body)));
      return jsonResponse({ status: "cancelled" });
    }
    if (url.pathname === "/api/v1/mail/signup") {
      const body = JSON.parse(String(init?.body)) as SignupBody;
      signups.push(body);
      if (signupStatus !== 200) {
        return jsonResponse({ error: "That address is taken." }, signupStatus);
      }
      const email = `${body.username}@${DOMAIN}`;
      return jsonResponse({
        ok: true,
        email,
        login: email,
        imap: { host: MAIL_HOST, port: 993, secure: true },
        smtp: { host: MAIL_HOST, port: 465, secure: true },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  }) as typeof fetch;
  try {
    await initSecurity({ home: securityHome, persist: false });
    setCsrfTokenForTest(TEST_TOKEN);
    await fn(home, signups, (s) => {
      signupStatus = s;
    }, payments);
  } finally {
    globalThis.fetch = realFetch;
    await Deno.remove(securityHome, { recursive: true });
    await Deno.remove(home, { recursive: true });
  }
}

async function createIdentity(home: string): Promise<void> {
  const res = await handleRequest(req("POST", "/api/v1/identity/generate", {
    name: "wizard",
    password: PASSWORD,
    signingType: "dilithium",
    encryptionType: "kyber",
    home,
  }));
  const text = await res.text();
  assert(res.status < 300, `generate failed: ${res.status} ${text}`);
}

Deno.test({
  name: "ebp-signup: provisions mailbox, stores email detail and mail account",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withEnv(async (home, signups) => {
      await createIdentity(home);

      const cfgRes = await handleRequest(req("GET", `/api/v1/mail/ebp-signup/config?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const cfg = await cfgRes.json();
      assertEquals(cfg.enabled, true);
      assertEquals(cfg.domain, DOMAIN);

      const userRes = await handleRequest(req("GET", `/api/v1/mail/ebp-signup/username?home=${encodeURIComponent(home)}&u=Alice&server=${SERVER}`));
      assertEquals((await userRes.json()).available, true);

      const badRes = await handleRequest(req("GET", `/api/v1/mail/ebp-signup/username?home=${encodeURIComponent(home)}&u=ab&server=${SERVER}`));
      const bad = await badRes.json();
      assertEquals(bad.available, false);
      assert(bad.reason);

      const res = await handleRequest(req("POST", "/api/v1/mail/ebp-signup", {
        home,
        server: SERVER,
        password: PASSWORD,
        username: "Alice",
      }));
      const body = await res.json();
      assertEquals(res.status, 200, JSON.stringify(body));
      assertEquals(body.email, `alice@${DOMAIN}`);
      assertEquals(body.connection.login, `alice@${DOMAIN}`);
      assertEquals(body.connection.password.length, 32);
      assertEquals(signups.length, 1);
      assertEquals(signups[0].username, "alice");
      assertEquals(signups[0].mailPassword, body.connection.password);

      const acctRes = await handleRequest(req("GET", `/api/v1/mail/account?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const acct = await acctRes.json();
      assertEquals(acct.selectedAccountId, body.accountId);
      assertEquals(acct.account.imapHost, MAIL_HOST);
      assertEquals(acct.account.fromEmail, `alice@${DOMAIN}`);
      assertEquals(acct.hasImapPassword, true);

      const idRes = await handleRequest(req("GET", `/api/v1/identity/public?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const idText = await idRes.text();
      assert(idText.includes(`alice@${DOMAIN}`), "identity should carry the email detail");

      const reconcile = (identity: string) => handleRequest(req("POST", "/api/v1/mail/ebp-signup/resume-state", {
        home, server: SERVER, identity, email: `alice@${DOMAIN}`,
      }));
      assertEquals((await (await reconcile("wizard")).json()).action, "completed");
      assertEquals((await (await reconcile("removed")).json()).action, "unavailable");
    });
  },
});

Deno.test({
  name: "ebp-payment signs separate recovery, order, and cancellation proofs",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withEnv(async (home, _signups, _setStatus, payments) => {
      await createIdentity(home);
      const common = { home, server: SERVER, identity: "wizard", password: PASSWORD, username: "Alice" };
      const recovery = await handleRequest(req("POST", "/api/v1/mail/ebp-payment/recover", common));
      assertEquals(recovery.status, 200, await recovery.clone().text());
      const order = await handleRequest(req("POST", "/api/v1/mail/ebp-payment/order", { ...common, network: "ethereum-sepolia", asset: "USDC" }));
      const result = await order.json();
      assertEquals(order.status, 200, JSON.stringify(result));
      assertEquals(result.checkoutUrl, "http://127.0.0.1:8789/checkout.html#123e4567-e89b-42d3-a456-426614174000");
      const cancellation = await handleRequest(req("POST", "/api/v1/mail/ebp-payment/cancel", {
        ...common, orderId: result.orderId, confirmUnpaid: true,
      }));
      assertEquals(cancellation.status, 200, await cancellation.clone().text());
      assertEquals(payments.length, 3);
      const decode = (value: unknown) => JSON.parse(new TextDecoder().decode(Uint8Array.from(String(value).match(/../g)!, (part) => parseInt(part, 16))));
      const recoveryProof = decode(payments[0].proof);
      const orderProof = decode(payments[1].proof);
      assertEquals(recoveryProof.path, "ebp-mail::payment-recover");
      assertEquals(orderProof.path, "ebp-mail::payment-order");
      assertEquals(orderProof.detail, JSON.stringify(["alice@test.pqpost.com", "ethereum-sepolia", "USDC"]));
      assertEquals(orderProof.nonce, recoveryProof.nonce + 1);
      const cancelProof = decode(payments[2].proof);
      assertEquals(cancelProof.path, "ebp-mail::payment-cancel");
      assertEquals(cancelProof.detail, result.orderId);
      assertEquals(cancelProof.nonce, orderProof.nonce + 1);
      assertEquals(Object.keys(payments[2]).sort(), ["confirmUnpaid", "orderId", "proof"]);
    });
  },
});

Deno.test({
  name: "concurrent payment proofs and detail changes preserve state and distinct nonces",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withEnv(async (home, _signups, _setStatus, payments) => {
      await createIdentity(home);
      const common = { home, server: SERVER, identity: "wizard", password: PASSWORD, username: "Alice" };
      const unlocked = await handleRequest(req("POST", "/api/v1/identity/unlock", common));
      assertEquals(unlocked.status, 200);
      const responses = await Promise.all([
        handleRequest(req("POST", "/api/v1/mail/ebp-payment/recover", common)),
        handleRequest(req("POST", "/api/v1/mail/ebp-payment/order", { ...common, network: "ethereum-sepolia", asset: "USDC" })),
        handleRequest(req("POST", "/api/v1/detail", { home, identity: "wizard", path: "name", detail: "Alice" })),
      ]);
      assertEquals(responses.map(response => response.status), [200, 200, 200]);
      const identity = Identity.fromStorageFormat(await Deno.readTextFile(`${home}/.ebp/wizard.identity.json`), PASSWORD);
      assertEquals(identity.getDetail("name"), "Alice");
      assertEquals(identity.detailsNonce, 3);
      const nonces = payments.map(payment => JSON.parse(hexToString(String(payment.proof))).nonce);
      nonces.push(JSON.parse(hexToString(identity.details.get("name")![1])).nonce);
      assertEquals(nonces.sort(), [0, 1, 2]);
    });
  },
});

Deno.test({
  name: "ebp-signup: server rejection leaves identity and mail store untouched",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withEnv(async (home, _signups, setSignupStatus) => {
      await createIdentity(home);
      setSignupStatus(409);
      const res = await handleRequest(req("POST", "/api/v1/mail/ebp-signup", {
        home,
        server: SERVER,
        password: PASSWORD,
        username: "bob",
      }));
      assertEquals(res.status, 409);
      await res.body?.cancel();

      const idRes = await handleRequest(req("GET", `/api/v1/identity/public?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const idText = await idRes.text();
      assert(!idText.includes(`bob@${DOMAIN}`));

      const acctRes = await handleRequest(req("GET", `/api/v1/mail/account?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const acct = await acctRes.json();
      assertEquals((acct.accounts ?? []).length, 0);
    });
  },
});

Deno.test({
  name: "ebp-signup: rejects invalid usernames before contacting the server",
  permissions: { read: true, write: true, env: true, net: true, sys: ["hostname"] },
  fn: async () => {
    await withEnv(async (home, signups) => {
      await createIdentity(home);
      const res = await handleRequest(req("POST", "/api/v1/mail/ebp-signup", {
        home,
        server: SERVER,
        password: PASSWORD,
        username: "postmaster",
      }));
      assertEquals(res.status, 400);
      await res.body?.cancel();
      assertEquals(signups.length, 0);
    });
  },
});
