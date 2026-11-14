#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env --allow-sys=hostname
// Create two e2e<digits>@test.pqpost.com mailboxes, send mail between them, then
// delete those mailboxes. Names of that shape are reserved for this test.
// The secret is MAIL_E2E_SECRET. It is not the Stalwart admin token.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import {
  createIdentityPayload,
  createSignedProof,
} from "../server/tests/helpers.ts";

export const TEST_MAIL_DOMAIN = "test.pqpost.com";
const LOCAL_KEY_SERVER = "http://127.0.0.1:8789";
const SECRET_HEADER = "x-ebp-e2e-secret";
const SWEEP_HOURS = 6;

export type Mailbox = { email: string; username: string; password: string };
export type MailTestConfig = {
  keyServer: string;
  mailHost: string;
  secret: string;
};
type Api = (path: string, init?: RequestInit) => Promise<Response>;
type MailTestDependencies = {
  fetchImpl?: typeof fetch;
  send?: typeof sendMail;
  wait?: typeof waitForMail;
};

export function loadEnvFile(path: string | URL): void {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = body.indexOf("=");
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      value.length >= 2 && value[0] === value[value.length - 1] &&
      (value[0] === '"' || value[0] === "'")
    ) {
      value = value.slice(1, -1);
    }
    if (key && Deno.env.get(key) === undefined) Deno.env.set(key, value);
  }
}

export function readMailTestConfig(): MailTestConfig {
  const keyServer = (Deno.env.get("EBP_KEY_SERVER")?.trim() || LOCAL_KEY_SERVER)
    .replace(/\/+$/, "");
  const url = new URL(keyServer);
  if (
    !["http:", "https:"].includes(url.protocol) || url.username ||
    url.password || url.search || url.hash
  ) {
    throw new Error(
      "EBP_KEY_SERVER must be an HTTP(S) base URL without credentials, query, or fragment.",
    );
  }
  const secret = (Deno.env.get("MAIL_E2E_SECRET") ?? "").trim();
  if (secret.length < 16) {
    throw new Error(
      "Set MAIL_E2E_SECRET (at least 16 characters) in .env.pqpost-mail.local and on the test key server.",
    );
  }
  return {
    keyServer,
    mailHost: Deno.env.get("MAIL_HOST")?.trim() || "mail.pqpost.com",
    secret,
  };
}

function randomUsername(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 90_000_000 +
    10_000_000;
  return `e2e${n}`;
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function createApi(config: MailTestConfig, fetchImpl: typeof fetch): Api {
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return await fetchImpl(`${config.keyServer}${path}`, {
      ...init,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  };
}

async function apiJson(
  api: Api,
  path: string,
  body: unknown,
  secret: string,
): Promise<Record<string, unknown>> {
  const res = await api(path, {
    method: "POST",
    headers: { [SECRET_HEADER]: secret },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `${path} returned ${res.status}: ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function publishIdentity(
  api: Api,
): Promise<ReturnType<typeof createIdentityPayload>> {
  const { payload, fingerprint, signingKey } = createIdentityPayload();
  const res = await api("/api/v1/identity", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publish identity returned ${res.status}: ${text}`);
  }
  await res.body?.cancel();
  return { payload, fingerprint, signingKey };
}

async function signup(
  api: Api,
  secret: string,
  created: string[],
): Promise<Mailbox> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const username = randomUsername();
    const password = randomPassword();
    const identity = await publishIdentity(api);
    const email = `${username}@${TEST_MAIL_DOMAIN}`;
    const { proof } = createSignedProof(identity.signingKey, {
      nonce: 0,
      path: "email",
      detail: email,
      timestamp: Date.now(),
    });
    const res = await api("/api/v1/mail/signup", {
      method: "POST",
      headers: { [SECRET_HEADER]: secret },
      body: JSON.stringify({
        fingerprint: identity.fingerprint,
        username,
        mailPassword: password,
        detailProof: proof,
      }),
    });
    if (res.status === 409) {
      await res.body?.cancel();
      continue;
    }
    // Track a successful creation before parsing or validating its response.
    // The first account must also be cleaned up if the second signup fails.
    if (res.ok) created.push(username);
    const payload = await res.json().catch(() => ({})) as {
      error?: string;
      email?: string;
      login?: string;
    };
    if (!res.ok) {
      throw new Error(
        `signup ${username} returned ${res.status}: ${JSON.stringify(payload)}`,
      );
    }
    if (payload.email !== email || payload.login !== email) {
      throw new Error(
        `signup did not return the expected test-domain email and login: ${email}`,
      );
    }
    console.log(`created ${email}`);
    return { email, username, password };
  }
  throw new Error("could not find a free e2e address");
}

async function sendMail(
  host: string,
  from: Mailbox,
  to: Mailbox,
  subject: string,
  text: string,
): Promise<void> {
  const transport = nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    auth: { user: from.email, pass: from.password },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from: from.email, to: to.email, subject, text });
  } finally {
    transport.close();
  }
}

async function inboxHas(
  host: string,
  account: Mailbox,
  subject: string,
): Promise<boolean> {
  const client = new ImapFlow({
    host,
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.password },
    disableCompression: true,
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 20_000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({ subject }, { uid: true });
      return Array.isArray(uids) && uids.length > 0;
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function waitForMail(
  host: string,
  account: Mailbox,
  subject: string,
): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await inboxHas(host, account, subject)) return;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`timed out waiting for ${subject} in ${account.email}`);
}

async function verifyTarget(api: Api, config: MailTestConfig): Promise<void> {
  const res = await api("/api/v1/mail/signup/config");
  if (!res.ok) throw new Error(`signup config returned HTTP ${res.status}`);
  const advertised = await res.json();
  if (advertised?.enabled !== true || advertised.domain !== TEST_MAIL_DOMAIN) {
    throw new Error(
      `Refusing to run: the key server must enable signup for ${TEST_MAIL_DOMAIN}.`,
    );
  }
  for (const [protocol, port] of [["imap", 993], ["smtp", 465]] as const) {
    const endpoint = advertised[protocol];
    if (
      endpoint?.host !== config.mailHost || endpoint.port !== port ||
      endpoint.secure !== true
    ) {
      throw new Error(
        `Refusing to run: ${protocol} must advertise TLS on ${config.mailHost}:${port}.`,
      );
    }
  }
}

export async function runMailE2e(
  config: MailTestConfig,
  deps: MailTestDependencies = {},
): Promise<void> {
  const api = createApi(config, deps.fetchImpl ?? fetch);
  // Verify before cleanup, identity publication, or mailbox creation.
  await verifyTarget(api, config);
  console.log(
    `testing ${TEST_MAIL_DOMAIN} through ${config.keyServer} (${config.mailHost})`,
  );

  const swept = await apiJson(api, "/api/v1/mail/e2e/cleanup", {
    sweepOlderThanHours: SWEEP_HOURS,
  }, config.secret);
  const sweptNames = Array.isArray(swept.removed) ? swept.removed : [];
  if (sweptNames.length > 0) {
    console.log(`swept ${sweptNames.length} old test mailbox(es)`);
  }

  const created: string[] = [];
  let testFailure: unknown;
  let testFailed = false;
  try {
    const from = await signup(api, config.secret, created);
    const to = await signup(api, config.secret, created);
    const token = crypto.randomUUID();
    const subject = `EBP e2e ${token}`;
    await (deps.send ?? sendMail)(
      config.mailHost,
      from,
      to,
      subject,
      `pqpost test-domain delivery ${token}`,
    );
    console.log(`sent ${from.email} -> ${to.email}`);
    await (deps.wait ?? waitForMail)(config.mailHost, to, subject);
    console.log(`received ${subject}`);
  } catch (err) {
    testFailed = true;
    testFailure = err;
  }
  // Both success and failure reach cleanup; report it without hiding test errors.
  try {
    if (created.length > 0) {
      const removed = await apiJson(api, "/api/v1/mail/e2e/cleanup", {
        usernames: created,
      }, config.secret);
      console.log(`deleted ${JSON.stringify(removed.removed ?? [])}`);
    }
  } catch (err) {
    if (testFailed) {
      throw new AggregateError(
        [testFailure, err],
        "Mail test failed and mailbox cleanup also failed.",
      );
    }
    throw err;
  }
  if (testFailed) throw testFailure;
}

async function startLocalServer(config: MailTestConfig): Promise<void> {
  if (!Deno.env.get("STALWART_ADMIN_TOKEN")?.trim()) {
    throw new Error(
      "Set STALWART_ADMIN_TOKEN in .env.pqpost-mail.local to provision test mailboxes.",
    );
  }
  const resultsDir = new URL("../test-results/", import.meta.url);
  const dbPath = new URL("pqpost-mail-e2e.sqlite", resultsDir).pathname;
  await Deno.mkdir(resultsDir, { recursive: true });
  // Set these before importing the server, whose configuration is read at import.
  // A production .env must never select this instance's database or domain ID.
  for (
    const [key, value] of Object.entries({
      DB_TYPE: "sqlite",
      DB_PATH: dbPath,
      MAIL_SIGNUP_ENABLED: "true",
      MAIL_DOMAIN: TEST_MAIL_DOMAIN,
      MAIL_HOST: config.mailHost,
      MAIL_E2E_SECRET: config.secret,
      STALWART_DOMAIN_ID: "",
      EXPECTED_HOSTS: "127.0.0.1,localhost",
      RATE_LIMIT_DISABLED: "true",
    })
  ) Deno.env.set(key, value);
  if (!Deno.env.get("STALWART_ADMIN_URL")?.trim()) {
    Deno.env.set("STALWART_ADMIN_URL", `https://${config.mailHost}`);
  }
  const { handleRequest, closeDb, startPaymentReconciliation } = await import(
    "../server/main.ts"
  );
  startPaymentReconciliation();
  console.log(`test mail domain: ${TEST_MAIL_DOMAIN}; database: ${dbPath}`);
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 8789 },
    async (req) => {
      const response = await serveLocalCheckout(req);
      return response ?? handleRequest(req);
    },
  );
  const shutdown = () => {
    void server.shutdown();
  };
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
  try {
    await server.finished;
  } finally {
    Deno.removeSignalListener("SIGINT", shutdown);
    Deno.removeSignalListener("SIGTERM", shutdown);
    await closeDb();
  }
}

/** Serve only the checkout assets from the loopback-only test server. */
export async function serveLocalCheckout(
  req: Request,
): Promise<Response | null> {
  if (req.method !== "GET") return null;
  const assets: Record<string, string> = {
    "/checkout.html": "text/html; charset=utf-8",
    "/checkout.js": "text/javascript; charset=utf-8",
    "/checkout.css": "text/css; charset=utf-8",
    "/styles.css": "text/css; charset=utf-8",
  };
  const path = new URL(req.url).pathname;
  if (!Object.hasOwn(assets, path)) return null;
  const text = await Deno.readTextFile(
    new URL(`../website${path}`, import.meta.url),
  );
  return new Response(text, {
    headers: {
      "content-type": assets[path],
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'",
    },
  });
}

if (import.meta.main) {
  if (Deno.args.some((arg) => arg !== "--server")) {
    throw new Error(
      "Usage: deno task test:pqpost-mail, or deno task server:pqpost-mail-test",
    );
  }
  loadEnvFile(new URL("../.env.pqpost-mail.local", import.meta.url));
  loadEnvFile(new URL("../.env", import.meta.url));
  const config = readMailTestConfig();
  if (Deno.args.includes("--server")) await startLocalServer(config);
  else await runMailE2e(config);
}
