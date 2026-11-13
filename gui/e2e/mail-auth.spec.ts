import { test, expect } from "@playwright/test";

test("mail setup offers password credentials and no provider sign-in", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("#mail-imap-host")).toBeAttached();
  await expect(page.locator("#mail-smtp-host")).toBeAttached();
  await expect(page.locator("#mail-auth-type, #mail-oauth-fields")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /sign in with (gmail|outlook)/i })).toHaveCount(0);

  const csrf = await request.get("/api/v1/csrf-token");
  const { token } = await csrf.json();
  for (const [method, path] of [
    ["POST", "start"], ["GET", "callback"], ["GET", "poll"],
    ["POST", "open-browser"], ["POST", "complete"],
  ]) {
    const res = await request.fetch(`/api/v1/mail/oauth/${path}`, {
      method, headers: { "x-ebp-csrf": token },
    });
    expect(res.status(), `local ${path}`).toBe(404);
  }
  for (const [method, path] of [["GET", "config"], ["POST", "exchange"], ["POST", "refresh"]]) {
    const res = await request.fetch(`http://localhost:8788/api/v1/mail/oauth/${path}`, { method });
    expect(res.status(), `public ${path}`).toBe(404);
  }
});

test("password account form saves IMAP and SMTP credentials", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  const submission = () => saved;
  await page.route("**/api/v1/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = {};
    if (path === "/api/v1/csrf-token") body = { token: "test-csrf" };
    if (path === "/api/v1/identity/unlock-status") body = { unlocked: true };
    if (path === "/api/v1/context") body = { currentIdentity: "me" };
    if (path === "/api/v1/identities") body = { identities: [{ name: "me" }], currentIdentity: "me" };
    if (path === "/api/v1/contacts") body = { contacts: [] };
    if (path === "/api/v1/mail/accounts") body = { accounts: [] };
    if (path === "/api/v1/mail/account") {
      if (request.method() === "POST") saved = request.postDataJSON();
      body = { account: saved?.account ?? null, accounts: [], secretsLocked: false };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/");
  await page.locator('.nav-item[data-page="mail"]').click();
  await page.locator('[data-mail-tab="account"]').click();
  await page.locator("#mail-account-new").click();
  await page.locator("#mail-account-name").fill("pqpost");
  await page.locator("#mail-imap-host").fill("mail.pqpost.test");
  await page.locator("#mail-smtp-host").fill("mail.pqpost.test");
  await page.locator("#mail-username").fill("alice@pqpost.test");
  await page.locator("#mail-from-email").fill("alice@pqpost.test");
  await page.locator("#mail-imap-password").fill("imap-test-password");
  await page.locator("#mail-smtp-password").fill("smtp-test-password");
  await page.locator('#mail-account-form button[type="submit"]').click();
  await expect(page.locator("#status")).toContainText("Mail account saved");
  expect(submission()).toMatchObject({
    account: {
      authType: "password", username: "alice@pqpost.test",
      imapHost: "mail.pqpost.test", smtpHost: "mail.pqpost.test",
    },
    imapPassword: "imap-test-password", smtpPassword: "smtp-test-password",
  });
  expect(submission()?.account).not.toHaveProperty("oauthProvider");
});
