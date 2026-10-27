#!/usr/bin/env -S deno run --allow-net --allow-read --allow-env
// Create two e2e<digits>@pqpost.com mailboxes, send mail between them, then
// delete those mailboxes. Names of that shape are reserved for this test.
// The secret is MAIL_E2E_SECRET. It is not the Stalwart admin token.

import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { createIdentityPayload, createSignedProof } from "../server/tests/helpers.ts";

const KEY_SERVER = (Deno.env.get("EBP_KEY_SERVER") ?? "https://ebp-cqyo.onrender.com").replace(/\/+$/, "");
const MAIL_HOST = Deno.env.get("MAIL_HOST") ?? "mail.pqpost.com";
const SECRET_HEADER = "x-ebp-e2e-secret";
const SWEEP_HOURS = 6;

type Mailbox = { email: string; username: string; password: string };

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed;
    const eq = body.indexOf("=");
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    if (key && Deno.env.get(key) === undefined) Deno.env.set(key, value);
  }
}

function randomUsername(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 90_000_000 + 10_000_000;
  return `e2e${n}`;
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return await fetch(`${KEY_SERVER}${path}`, { ...init, headers });
}

async function apiJson(path: string, body: unknown, secret: string): Promise<Record<string, unknown>> {
  const res = await api(path, {
    method: "POST",
    headers: { [SECRET_HEADER]: secret },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`${path} returned ${res.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function publishIdentity(): Promise<{ fingerprint: string; signingKey: { sign: (message: string) => string } }> {
  const { payload, fingerprint, signingKey } = createIdentityPayload();
  const res = await api("/api/v1/identity", { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publish identity returned ${res.status}: ${text}`);
  }
  await res.body?.cancel();
  return { fingerprint, signingKey };
}

async function signup(secret: string): Promise<Mailbox> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const username = randomUsername();
    const password = randomPassword();
    const identity = await publishIdentity();
    const email = `${username}@pqpost.com`;
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
    const payload = await res.json().catch(() => ({})) as { error?: string; email?: string };
    if (res.status === 409) continue;
    if (!res.ok) throw new Error(`signup ${username} returned ${res.status}: ${JSON.stringify(payload)}`);
    console.log(`created ${payload.email ?? email}`);
    return { email, username, password };
  }
  throw new Error("could not find a free e2e address");
}

async function sendMail(from: Mailbox, to: Mailbox, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: MAIL_HOST,
    port: 465,
    secure: true,
    auth: { user: from.email, pass: from.password },
  });
  try {
    await transport.sendMail({ from: from.email, to: to.email, subject, text });
  } finally {
    transport.close();
  }
}

async function inboxHas(account: Mailbox, subject: string): Promise<boolean> {
  const client = new ImapFlow({
    host: MAIL_HOST,
    port: 993,
    secure: true,
    auth: { user: account.email, pass: account.password },
    disableCompression: true,
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 20_000,
  });
  client.on("error", () => {});
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = await client.search({ subject }, { uid: true });
    return Array.isArray(uids) && uids.length > 0;
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
}

async function waitForMail(account: Mailbox, subject: string): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await inboxHas(account, subject)) return;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(`timed out waiting for ${subject} in ${account.email}`);
}

async function main(): Promise<void> {
  loadEnvFile(new URL("../.env", import.meta.url).pathname);
  const secret = (Deno.env.get("MAIL_E2E_SECRET") ?? "").trim();
  if (secret.length < 16) {
    throw new Error("Set MAIL_E2E_SECRET in .env and on the key server, then deploy.");
  }

  const swept = await apiJson("/api/v1/mail/e2e/cleanup", { sweepOlderThanHours: SWEEP_HOURS }, secret);
  const sweptNames = Array.isArray(swept.removed) ? swept.removed : [];
  if (sweptNames.length > 0) console.log(`swept ${sweptNames.length} old test mailbox(es)`);

  const created: string[] = [];
  try {
    const from = await signup(secret);
    const to = await signup(secret);
    created.push(from.username, to.username);
    const token = crypto.randomUUID();
    const subject = `EBP e2e ${token}`;
    await sendMail(from, to, subject, `pqpost local delivery ${token}`);
    console.log(`sent ${from.email} -> ${to.email}`);
    await waitForMail(to, subject);
    console.log(`received ${subject}`);
  } finally {
    if (created.length > 0) {
      const removed = await apiJson("/api/v1/mail/e2e/cleanup", { usernames: created }, secret);
      console.log(`deleted ${JSON.stringify(removed.removed ?? [])}`);
    }
  }
}

if (import.meta.main) {
  await main();
}
