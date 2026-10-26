import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { createIdentityPayload, createSignedProof } from "./helpers.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
  buildMailPasswordResetDetail,
  MAIL_PASSWORD_RESET_PATH,
  validateMailUsername,
} from "../../core/MailUsername.ts";
import { setStalwartClientForTests } from "../handlers/mail-signup.ts";
import { StalwartClient } from "../stalwart.ts";
import { rateLimitStore } from "../rate-limit.ts";

type MainModule = typeof import("../main.ts");

const DOMAIN = "pqpost.test";
const MAIL_PASSWORD = "x".repeat(32);

type FakeStalwart = {
  calls: Array<{ method: string; args: Record<string, unknown> }>;
  failCreate: boolean;
  accounts: Map<string, string>;
};

function installFakeStalwart(): FakeStalwart {
  const state: FakeStalwart = { calls: [], failCreate: false, accounts: new Map() };
  let nextId = 1;
  const fakeFetch = (_url: string, init: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init.body));
    const [method, args] = body.methodCalls[0];
    state.calls.push({ method, args });
    let result: Record<string, unknown> = {};
    if (method === "x:Domain/get") {
      result = { list: [{ id: "d1", name: DOMAIN }] };
    } else if (method === "x:Account/set" && args.create) {
      if (state.failCreate) {
        result = { notCreated: { new1: { type: "serverFail", description: "boom" } } };
      } else {
        const id = `a${nextId++}`;
        state.accounts.set(id, args.create.new1.name);
        result = { created: { new1: { id } } };
      }
    } else if (method === "x:Account/set" && args.destroy) {
      for (const id of args.destroy) state.accounts.delete(id);
      result = { destroyed: args.destroy };
    } else if (method === "x:Account/set" && args.update) {
      result = { updated: args.update };
    }
    return Promise.resolve(
      new Response(JSON.stringify({ methodResponses: [[method, result, "c1"]] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  setStalwartClientForTests(
    new StalwartClient({ baseUrl: "https://stalwart.test", token: "t", domainId: null }, fakeFetch),
  );
  return state;
}

async function withServer(
  fn: (mod: MainModule, stalwart: FakeStalwart) => Promise<void>,
  opts: { enabled?: boolean } = {},
): Promise<void> {
  const dbPath = await Deno.makeTempFile({ suffix: ".sqlite" });
  Deno.env.set("DB_PATH", dbPath);
  Deno.env.set("MAIL_DOMAIN", DOMAIN);
  Deno.env.set("MAIL_HOST", `mail.${DOMAIN}`);
  Deno.env.set("MAIL_SIGNUP_ENABLED", opts.enabled === false ? "false" : "true");
  const stalwart = installFakeStalwart();
  rateLimitStore.clear();
  const mod: MainModule = await import(`../main.ts#${crypto.randomUUID()}`);
  try {
    await fn(mod, stalwart);
  } finally {
    try {
      await mod.closeDb();
    } catch {
      // ignore
    }
    try {
      Deno.removeSync(dbPath);
    } catch {
      // ignore
    }
    setStalwartClientForTests(null);
    for (const key of ["DB_PATH", "MAIL_DOMAIN", "MAIL_HOST", "MAIL_SIGNUP_ENABLED"]) {
      Deno.env.delete(key);
    }
  }
}

async function registerIdentity(mod: MainModule) {
  const { payload, fingerprint, signingKey } = createIdentityPayload();
  const res = await mod.handleRequest(
    new Request("http://localhost/api/v1/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  assertEquals(res.status, 200);
  await res.body?.cancel();
  return { fingerprint, signingKey };
}

function post(mod: MainModule, path: string, body: unknown): Promise<Response> {
  rateLimitStore.clear();
  return mod.handleRequest(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function get(mod: MainModule, path: string): Promise<Response> {
  return mod.handleRequest(new Request(`http://localhost${path}`));
}

async function signup(
  mod: MainModule,
  identity: Awaited<ReturnType<typeof registerIdentity>>,
  username: string,
  nonce = 0,
): Promise<Response> {
  const { proof } = createSignedProof(identity.signingKey, {
    nonce,
    path: "email",
    detail: `${username.toLowerCase()}@${DOMAIN}`,
    timestamp: Date.now(),
  });
  return await post(mod, "/api/v1/mail/signup", {
    fingerprint: identity.fingerprint,
    username,
    mailPassword: MAIL_PASSWORD,
    detailProof: proof,
  });
}

Deno.test("validateMailUsername enforces shape and reserved names", () => {
  assert(validateMailUsername("Alice.Smith").ok);
  assertEquals(validateMailUsername("Alice").ok && validateMailUsername("Alice").username, "alice");
  assert(!validateMailUsername("ab").ok);
  assert(!validateMailUsername("a".repeat(31)).ok);
  assert(!validateMailUsername("-alice").ok);
  assert(!validateMailUsername("al..ice").ok);
  assert(!validateMailUsername("al_ice").ok);
  assert(!validateMailUsername("postmaster").ok);
});

Deno.test("mail signup config reports disabled when flag is off", async () => {
  await withServer(async (mod) => {
    const res = await get(mod, "/api/v1/mail/signup/config");
    assertEquals(await res.json(), { enabled: false });
    const signupRes = await post(mod, "/api/v1/mail/signup", {});
    assertEquals(signupRes.status, 503);
    await signupRes.body?.cancel();
  }, { enabled: false });
});

Deno.test("mail signup config returns domain and connection info", async () => {
  await withServer(async (mod) => {
    const res = await get(mod, "/api/v1/mail/signup/config");
    const body = await res.json();
    assertEquals(body.enabled, true);
    assertEquals(body.domain, DOMAIN);
    assertEquals(body.imap, { host: `mail.${DOMAIN}`, port: 993, secure: true });
    assertEquals(body.smtp, { host: `mail.${DOMAIN}`, port: 465, secure: true });
  });
});

Deno.test("signup provisions mailbox, stores verified email detail", async () => {
  await withServer(async (mod, stalwart) => {
    const identity = await registerIdentity(mod);
    const res = await signup(mod, identity, "Alice");
    const body = await res.json();
    assertEquals(res.status, 200, JSON.stringify(body));
    assertEquals(body.email, `alice@${DOMAIN}`);
    assertEquals(body.login, `alice@${DOMAIN}`);
    assertEquals(stalwart.accounts.size, 1);
    const createCall = stalwart.calls.find((c) => c.method === "x:Account/set");
    const created = (createCall!.args.create as Record<string, Record<string, unknown>>).new1;
    assertEquals(created.name, "alice");
    assertEquals(created.domainId, "d1");

    const idRes = await get(mod, `/api/v1/identity/${identity.fingerprint}`);
    const idBody = await idRes.json();
    assertEquals(idBody.details.email[0], `alice@${DOMAIN}`);
    assertEquals(idBody.detailsMeta.email.verified, true);

    const availRes = await get(mod, "/api/v1/mail/username-available?u=alice");
    const avail = await availRes.json();
    assertEquals(avail.available, false);
  });
});

Deno.test("username-available rejects reserved and accepts free names", async () => {
  await withServer(async (mod) => {
    const reserved = await (await get(mod, "/api/v1/mail/username-available?u=admin")).json();
    assertEquals(reserved.available, false);
    assert(reserved.reason);
    const free = await (await get(mod, "/api/v1/mail/username-available?u=bob")).json();
    assertEquals(free, { available: true, username: "bob", email: `bob@${DOMAIN}` });
  });
});

Deno.test("signup rejects unpublished identity and bad proofs", async () => {
  await withServer(async (mod, stalwart) => {
    const { fingerprint, signingKey } = createIdentityPayload();
    const unpublished = await signup(mod, { fingerprint, signingKey }, "carol");
    assertEquals(unpublished.status, 400);
    await unpublished.body?.cancel();

    const identity = await registerIdentity(mod);
    const { proof } = createSignedProof(identity.signingKey, {
      nonce: 0,
      path: "email",
      detail: `someone-else@${DOMAIN}`,
      timestamp: Date.now(),
    });
    const bad = await post(mod, "/api/v1/mail/signup", {
      fingerprint: identity.fingerprint,
      username: "carol",
      mailPassword: MAIL_PASSWORD,
      detailProof: proof,
    });
    assertEquals(bad.status, 400);
    await bad.body?.cancel();
    assertEquals(stalwart.accounts.size, 0);
  });
});

Deno.test("signup enforces unique username and one mailbox per identity", async () => {
  await withServer(async (mod) => {
    const first = await registerIdentity(mod);
    const ok = await signup(mod, first, "dave");
    assertEquals(ok.status, 200);
    await ok.body?.cancel();

    const again = await signup(mod, first, "dave2", 1);
    assertEquals(again.status, 409);
    await again.body?.cancel();

    const second = await registerIdentity(mod);
    const dup = await signup(mod, second, "dave");
    assertEquals(dup.status, 409);
    await dup.body?.cancel();
  });
});

Deno.test("signup rolls back reservation when Stalwart fails", async () => {
  await withServer(async (mod, stalwart) => {
    const identity = await registerIdentity(mod);
    stalwart.failCreate = true;
    const failed = await signup(mod, identity, "erin");
    assertEquals(failed.status, 502);
    await failed.body?.cancel();

    const avail = await (await get(mod, "/api/v1/mail/username-available?u=erin")).json();
    assertEquals(avail.available, true);

    stalwart.failCreate = false;
    const retry = await signup(mod, identity, "erin");
    assertEquals(retry.status, 200);
    await retry.body?.cancel();
  });
});

Deno.test("reset-password requires a fresh identity-signed proof", async () => {
  await withServer(async (mod, stalwart) => {
    const identity = await registerIdentity(mod);
    const ok = await signup(mod, identity, "frank");
    assertEquals(ok.status, 200);
    await ok.body?.cancel();

    const newPassword = "n".repeat(24);
    const detail = buildMailPasswordResetDetail(`frank@${DOMAIN}`, sha256Hex(newPassword));
    const { proof } = createSignedProof(identity.signingKey, {
      nonce: 1,
      path: MAIL_PASSWORD_RESET_PATH,
      detail,
      timestamp: Date.now(),
    });
    const res = await post(mod, "/api/v1/mail/reset-password", {
      fingerprint: identity.fingerprint,
      mailPassword: newPassword,
      proof,
    });
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assert(stalwart.calls.some((c) => c.method === "x:Account/set" && c.args.update));

    const mismatched = await post(mod, "/api/v1/mail/reset-password", {
      fingerprint: identity.fingerprint,
      mailPassword: "z".repeat(24),
      proof,
    });
    assertEquals(mismatched.status, 400);
    await mismatched.body?.cancel();

    const stale = createSignedProof(identity.signingKey, {
      nonce: 2,
      path: MAIL_PASSWORD_RESET_PATH,
      detail,
      timestamp: Date.now() - 60 * 60_000,
    });
    const staleRes = await post(mod, "/api/v1/mail/reset-password", {
      fingerprint: identity.fingerprint,
      mailPassword: newPassword,
      proof: stale.proof,
    });
    assertEquals(staleRes.status, 400);
    await staleRes.body?.cancel();
  });
});
