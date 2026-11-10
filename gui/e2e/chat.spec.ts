import { expect, test, type Page } from "@playwright/test";

const BOB = {
  name: "Bob",
  fingerprint: "ebp1bobfingerprint00000000000000000000",
  details: { email: ["bob@example.com", "proof"] },
};

async function mockBackend(page: Page) {
  const sent: Record<string, unknown>[] = [];
  let unlocked = false;
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
    if (pathname === "/api/v1/identity/unlock-status") return json({ unlocked });
    if (pathname === "/api/v1/identity/unlock") {
      unlocked = true;
      return json({ unlocked });
    }
    if (pathname === "/api/v1/contacts") return json({ contacts: [] });
    if (pathname === "/api/v1/contacts/resolve-verified-email") {
      return json({ status: "unique", name: "Bob", fingerprint: BOB.fingerprint, imported: false });
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
      return json({
        selectedAccountId: "mock-account",
        secretsInMemory: true,
        secretsLocked: false,
        accounts: [],
      });
    }
    if (pathname === "/api/v1/mail/messages") {
      return json({
        messages: [{
          uid: 4,
          subject: "Board notes",
          from: "Ada <ada@example.com>",
          to: "me@example.com",
          date: Date.now(),
          seen: true,
          size: 100,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      });
    }
    if (pathname === "/api/v1/mail/chat") {
      return json({
        ownAddress: "me@example.com",
        conversations: [{
          peer: "bob@example.com",
          latestDate: Date.now(),
          unread: 0,
          messages: [{
            uid: 9,
            folder: "INBOX",
            folderKind: "inbox",
            from: "bob@example.com",
            to: "me@example.com",
            date: Date.now(),
            seen: true,
            messageId: "<prev@example.com>",
            outbound: false,
          }],
        }],
      });
    }
    if (pathname === "/api/v1/mail/send-ebp") {
      sent.push(request.postDataJSON());
      return json({ ok: true, messageId: "<sent@example.com>" });
    }
    if (request.method() === "POST") return json({ ok: true });
    if (request.method() === "GET") return json({});
    return route.fulfill({ status: 404, body: "not mocked" });
  });
  return sent;
}

test("chat sends on the mail channel and mail keeps its own list", async ({ page }) => {
  const sent = await mockBackend(page);
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Chat" }).click();
  await expect(page.locator("#password-modal")).toBeVisible();
  await page.locator("#password-modal-input").fill("test-password");
  await page.locator("#password-modal-confirm").click();
  await expect(page.locator("#chat-conversation-list")).toContainText("bob@example.com");

  await page.locator("#chat-conversation-list li", { hasText: "bob@example.com" }).click();
  await page.fill("#chat-compose-body", "hello from chat");
  await page.locator("#chat-send-btn").click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0]).toMatchObject({
    channel: "chat",
    message: "hello from chat",
    recipient: "Bob",
    inReplyTo: "<prev@example.com>",
    references: "<prev@example.com>",
    recipients: [{ contact: "Bob", email: "bob@example.com" }],
  });

  await page.locator(".nav-item", { hasText: "Mail" }).click();
  await expect(page.locator("#mail-message-list")).toContainText("Board notes");
  await expect(page.locator("#mail-message-list")).not.toContainText("bob@example.com");
});
