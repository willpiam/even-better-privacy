import { expect, test, type Page } from "@playwright/test";

const ALICE = {
  name: "Alice",
  fingerprint: "ebp1alicefingerprint0000000000000000",
  details: { email: ["alice@example.com", "proof"] },
};
const BOB = {
  name: "Bob",
  fingerprint: "ebp1bobfingerprint00000000000000000000",
  details: { email: ["bob@example.com", "proof"] },
};

type SentRequests = {
  sendEbp: Record<string, unknown>[];
  send: Record<string, unknown>[];
};

async function mockBackend(page: Page): Promise<SentRequests> {
  const sent: SentRequests = { sendEbp: [], send: [] };
  let bobImported = false;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const json = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (pathname === "/api/v1/csrf-token") return json({ token: "test-csrf" });
    if (pathname === "/api/v1/health") {
      return json({ ok: true, protocolVersion: "test", componentVersion: "test" });
    }
    if (pathname === "/api/v1/context") {
      return json({
        identityDir: "/tmp/ebp-test",
        contactsDir: "/tmp/ebp-test/contacts",
        currentIdentity: "me",
        server: null,
        protocolVersion: "test",
      });
    }
    if (pathname === "/api/v1/identities") {
      return json({ identities: [{ name: "me", fingerprint: "ebp1me" }], currentIdentity: "me" });
    }
    if (pathname === "/api/v1/contacts") {
      return json({ contacts: bobImported ? [ALICE, BOB] : [ALICE] });
    }
    if (pathname === "/api/v1/contacts/resolve-verified-email") {
      const email = url.searchParams.get("email");
      if (email === "bob@example.com") {
        bobImported = true;
        return json({ status: "unique", name: "Bob", fingerprint: BOB.fingerprint, imported: true });
      }
      return json({ status: "none" });
    }
    if (pathname === "/api/v1/mail/ebp-signup/config") return json({ enabled: false });
    if (pathname === "/api/v1/mail/account") {
      return json({
        accountId: "mock-account",
        accountName: "Mock account",
        account: {
          imapHost: "imap.example.com",
          imapPort: 993,
          imapSecure: true,
          smtpHost: "smtp.example.com",
          smtpPort: 465,
          smtpSecure: true,
          username: "me@example.com",
          fromEmail: "me@example.com",
          fromName: "Me",
          persistSecrets: false,
        },
        selectedAccountId: "mock-account",
        accounts: [{ id: "mock-account", name: "Mock account" }],
        secretsInMemory: true,
        secretsLocked: false,
      });
    }
    if (pathname === "/api/v1/mail/accounts") {
      return json({ selectedAccountId: "mock-account", secretsInMemory: true, secretsLocked: false, accounts: [] });
    }
    if (pathname === "/api/v1/mail/send-ebp") {
      sent.sendEbp.push(request.postDataJSON());
      return json({ ok: true });
    }
    if (pathname === "/api/v1/mail/send") {
      sent.send.push(request.postDataJSON());
      return json({ ok: true });
    }
    if (request.method() === "POST") return json({ ok: true });
    if (request.method() === "GET") return json({});
    return route.fulfill({ status: 404, body: "not mocked" });
  });

  return sent;
}

async function openCompose(page: Page) {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Mail" }).click();
  await page.locator('[data-mail-tab="compose"]').click();
  await expect(page.locator("#mail-compose-to-input")).toBeVisible();
}

async function pasteRecipients(page: Page, text: string) {
  await page.locator("#mail-compose-to-input").evaluate((input, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    input.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

function chip(page: Page, email: string) {
  return page.locator(`#mail-compose-to-chip-list .recipient-chip[data-email="${email}"]`);
}

async function unlockIfPrompted(page: Page) {
  const modal = page.locator("#password-modal");
  try {
    await modal.waitFor({ state: "visible", timeout: 2_000 });
  } catch {
    return;
  }
  await page.fill("#password-modal-input", "Smoke-test-password1");
  await page.locator("#password-modal-confirm").click();
}

test("pasted list becomes chips and unresolved or mixed recipients block send", async ({ page }) => {
  const sent = await mockBackend(page);
  await openCompose(page);

  await pasteRecipients(
    page,
    "Alice <alice@example.com>, bob@example.com; carol@example.com\nnot-an-email, ALICE@example.com",
  );

  await expect(page.locator("#mail-compose-to-chip-list .recipient-chip")).toHaveCount(4);
  await expect(chip(page, "alice@example.com")).toHaveAttribute("data-state", "encrypted");
  await expect(chip(page, "alice@example.com")).toContainText("Alice");
  await expect(chip(page, "bob@example.com")).toHaveAttribute("data-state", "encrypted");
  await expect(chip(page, "bob@example.com")).toContainText("Bob");
  await expect(chip(page, "carol@example.com")).toHaveAttribute("data-state", "unresolved");
  await expect(chip(page, "not-an-email")).toHaveAttribute("data-state", "invalid");

  const sendBtn = page.locator("#mail-compose-send-btn");
  const status = page.locator("#mail-compose-recipient-status");
  await expect(sendBtn).toBeDisabled();
  await expect(status).toContainText("invalid");

  await page.getByRole("button", { name: "Remove not-an-email" }).click();
  await expect(sendBtn).toBeDisabled();
  await expect(status).toContainText("amber");

  await chip(page, "carol@example.com").locator(".recipient-chip-label").click();
  const modal = page.locator("#mail-recipient-resolve-modal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#mail-recipient-resolve-email")).toHaveText("carol@example.com");
  await page.locator("#mail-recipient-resolve-plaintext").click();
  await expect(modal).toBeHidden();
  await expect(chip(page, "carol@example.com")).toHaveAttribute("data-state", "plaintext");

  await expect(sendBtn).toBeDisabled();
  await expect(status).toContainText("send to them separately");
  await expect(page.locator("#mail-compose-plaintext-banner")).toBeHidden();

  await page.getByRole("button", { name: "Remove alice@example.com" }).click();
  await page.getByRole("button", { name: "Remove bob@example.com" }).click();

  await expect(page.locator("#mail-compose-plaintext-banner")).toBeVisible();
  await expect(sendBtn).toHaveText("Send unencrypted");
  await expect(sendBtn).toBeEnabled();

  await page.fill("#mail-compose-subject", "Plain hello");
  await page.fill("#mail-compose-body", "plain body");
  await sendBtn.click();

  await expect.poll(() => sent.send.length).toBe(1);
  expect(sent.sendEbp).toHaveLength(0);
  expect(sent.send[0]).toMatchObject({
    to: "carol@example.com",
    subject: "Plain hello",
    text: "plain body",
  });
  await expect(page.locator("#mail-compose-to-chip-list .recipient-chip")).toHaveCount(0);
  await expect(sendBtn).toBeDisabled();
});

test("typed recipients resolve to encrypted chips and send one multi-recipient payload", async ({ page }) => {
  const sent = await mockBackend(page);
  await openCompose(page);

  const input = page.locator("#mail-compose-to-input");
  await input.click();
  await page.keyboard.type("alice@example.com,");
  await page.keyboard.type("bob@example.com");
  await page.keyboard.press("Enter");

  await expect(chip(page, "alice@example.com")).toHaveAttribute("data-state", "encrypted");
  await expect(chip(page, "bob@example.com")).toHaveAttribute("data-state", "encrypted");

  const sendBtn = page.locator("#mail-compose-send-btn");
  await expect(sendBtn).toHaveText("Send encrypted");
  await expect(sendBtn).toBeEnabled();
  await expect(page.locator("#mail-compose-plaintext-banner")).toBeHidden();

  await page.fill("#mail-compose-subject", "Secret hello");
  await page.fill("#mail-compose-body", "secret body");
  await sendBtn.click();
  await unlockIfPrompted(page);

  await expect.poll(() => sent.sendEbp.length).toBe(1);
  expect(sent.send).toHaveLength(0);
  expect(sent.sendEbp[0]).toMatchObject({
    subject: "Secret hello",
    message: "secret body",
    recipients: [
      { contact: "Alice", email: "alice@example.com" },
      { contact: "Bob", email: "bob@example.com" },
    ],
  });
});

test("resolve dialog assigns a contact to an unresolved chip", async ({ page }) => {
  await mockBackend(page);
  await openCompose(page);

  await page.fill("#mail-compose-to-input", "carol@example.com");
  await page.press("#mail-compose-to-input", "Enter");
  await expect(chip(page, "carol@example.com")).toHaveAttribute("data-state", "unresolved");
  await expect(page.locator("#mail-compose-send-btn")).toBeDisabled();

  await chip(page, "carol@example.com").locator(".recipient-chip-label").click();
  await page.fill("#mail-recipient-resolve-search", "ali");
  await page.locator("#mail-recipient-resolve-list .contact-search-item", { hasText: "Alice" }).click();

  await expect(chip(page, "carol@example.com")).toHaveAttribute("data-state", "encrypted");
  await expect(chip(page, "carol@example.com")).toContainText("Alice");
  await expect(page.locator("#mail-compose-send-btn")).toHaveText("Send encrypted");
});
