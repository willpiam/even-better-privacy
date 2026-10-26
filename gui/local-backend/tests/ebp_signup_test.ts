import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { handleRequest } from "../routes.ts";
import { initSecurity, setCsrfTokenForTest } from "../security.ts";

const TEST_TOKEN = "s".repeat(64);
const PASSWORD = "Correct-Horse-Battery-9";
const DOMAIN = "pqpost.test";
const SERVER = "https://keys.test";

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
  fn: (home: string, signups: SignupBody[], setSignupStatus: (s: number) => void) => Promise<void>,
): Promise<void> {
  const securityHome = await Deno.makeTempDir({ prefix: "ebp-signup-sec-" });
  const home = await Deno.makeTempDir({ prefix: "ebp-signup-home-" });
  const realFetch = globalThis.fetch;
  const signups: SignupBody[] = [];
  let signupStatus = 200;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/api/v1/mail/signup/config") {
      return jsonResponse({
        enabled: true,
        domain: DOMAIN,
        imap: { host: `mail.${DOMAIN}`, port: 993, secure: true },
        smtp: { host: `mail.${DOMAIN}`, port: 465, secure: true },
      });
    }
    if (url.pathname === "/api/v1/mail/username-available") {
      const u = url.searchParams.get("u");
      return jsonResponse({ available: u !== "taken", username: u });
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
        imap: { host: `mail.${DOMAIN}`, port: 993, secure: true },
        smtp: { host: `mail.${DOMAIN}`, port: 465, secure: true },
      });
    }
    return jsonResponse({ error: "unexpected" }, 500);
  }) as typeof fetch;
  try {
    await initSecurity({ home: securityHome, persist: false });
    setCsrfTokenForTest(TEST_TOKEN);
    await fn(home, signups, (s) => {
      signupStatus = s;
    });
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
      assertEquals(acct.account.imapHost, `mail.${DOMAIN}`);
      assertEquals(acct.account.fromEmail, `alice@${DOMAIN}`);
      assertEquals(acct.hasImapPassword, true);

      const idRes = await handleRequest(req("GET", `/api/v1/identity/public?home=${encodeURIComponent(home)}&server=${SERVER}`));
      const idText = await idRes.text();
      assert(idText.includes(`alice@${DOMAIN}`), "identity should carry the email detail");
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
