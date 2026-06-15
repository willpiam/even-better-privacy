import { assertEquals } from "jsr:@std/assert@^1.0.6";

const GMAIL_ID = "test-gmail-id.apps.googleusercontent.com";
const OUTLOOK_ID = "test-outlook-client-id";

async function withOAuthEnv(
  fn: (mod: typeof import("../mail-oauth.ts")) => Promise<void>,
): Promise<void> {
  const priorGmail = Deno.env.get("MAIL_OAUTH_GMAIL_CLIENT_ID");
  const priorOutlook = Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_ID");
  const priorGmailSecret = Deno.env.get("MAIL_OAUTH_GMAIL_CLIENT_SECRET");
  const priorOutlookSecret = Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_SECRET");

  Deno.env.set("MAIL_OAUTH_GMAIL_CLIENT_ID", GMAIL_ID);
  Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_ID", OUTLOOK_ID);
  Deno.env.set("MAIL_OAUTH_GMAIL_CLIENT_SECRET", "gmail-secret-not-public");
  Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_SECRET", "outlook-secret-not-public");

  const mod = await import(`../mail-oauth.ts#${crypto.randomUUID()}`);

  try {
    await fn(mod);
  } finally {
    if (priorGmail === undefined) Deno.env.delete("MAIL_OAUTH_GMAIL_CLIENT_ID");
    else Deno.env.set("MAIL_OAUTH_GMAIL_CLIENT_ID", priorGmail);
    if (priorOutlook === undefined) Deno.env.delete("MAIL_OAUTH_OUTLOOK_CLIENT_ID");
    else Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_ID", priorOutlook);
    if (priorGmailSecret === undefined) Deno.env.delete("MAIL_OAUTH_GMAIL_CLIENT_SECRET");
    else Deno.env.set("MAIL_OAUTH_GMAIL_CLIENT_SECRET", priorGmailSecret);
    if (priorOutlookSecret === undefined) Deno.env.delete("MAIL_OAUTH_OUTLOOK_CLIENT_SECRET");
    else Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_SECRET", priorOutlookSecret);
  }
}

Deno.test("getOAuthPublicProviderConfig exposes client IDs without secrets", async () => {
  await withOAuthEnv(async (mod) => {
    const providers = mod.getOAuthPublicProviderConfig();
    assertEquals(providers.gmail.clientId, GMAIL_ID);
    assertEquals(providers.gmail.configured, true);
    assertEquals(providers.outlook.clientId, OUTLOOK_ID);
    assertEquals(providers.outlook.configured, true);
  });
});

Deno.test("handleOAuthConfig returns public provider config JSON", async () => {
  await withOAuthEnv(async (mod) => {
    const res = mod.handleOAuthConfig();
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.providers.gmail.clientId, GMAIL_ID);
    assertEquals(body.providers.gmail.configured, true);
    assertEquals(body.providers.outlook.clientId, OUTLOOK_ID);
    assertEquals(body.providers.outlook.configured, true);
    const serialized = JSON.stringify(body);
    assertEquals(serialized.includes("clientSecret"), false);
    assertEquals(serialized.includes("gmail-secret-not-public"), false);
    assertEquals(serialized.includes("outlook-secret-not-public"), false);
  });
});

Deno.test("getOAuthPublicProviderConfig marks empty client ID as not configured", async () => {
  const priorOutlook = Deno.env.get("MAIL_OAUTH_OUTLOOK_CLIENT_ID");
  Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_ID", "");
  const mod = await import(`../mail-oauth.ts#${crypto.randomUUID()}`);
  try {
    const providers = mod.getOAuthPublicProviderConfig();
    assertEquals(providers.outlook.clientId, "");
    assertEquals(providers.outlook.configured, false);
  } finally {
    if (priorOutlook === undefined) Deno.env.delete("MAIL_OAUTH_OUTLOOK_CLIENT_ID");
    else Deno.env.set("MAIL_OAUTH_OUTLOOK_CLIENT_ID", priorOutlook);
  }
});
