import { expect, test, type Page } from "@playwright/test";

const ARMOR = [
  "-----BEGIN EBP MESSAGE-----",
  '{"type":"ebp-encrypted-signed-message","ciphertext":"aabbcc"}',
  "-----END EBP MESSAGE-----",
].join("\n");

const ENCRYPTED_PAYLOAD = {
  type: "ebp-encrypted-signed-message",
  ciphertext: "aabbcc",
};

async function mockBackend(page: Page) {
  let decryptBody: Record<string, unknown> | null = null;

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
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
    if (pathname === "/api/v1/contacts") return json({ contacts: [] });
    if (pathname === "/api/v1/identity/unlock-status") {
      return json({ unlocked: false });
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
        accountId: "mock-account",
        folder: "INBOX",
        messages: [{
          uid: 7,
          subject: "Encrypted hello",
          from: "Alice <alice@example.com>",
          to: "me@example.com",
          date: Date.now(),
          seen: false,
          size: 240,
        }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      });
    }
    if (pathname === "/api/v1/mail/message") {
      return json({
        accountId: "mock-account",
        uid: 7,
        subject: "Encrypted hello",
        from: "Alice <alice@example.com>",
        to: "me@example.com",
        date: Date.now(),
        size: 240,
        text: ARMOR,
        html: "",
        attachments: [],
        ebpPayload: ENCRYPTED_PAYLOAD,
      });
    }
    if (pathname === "/api/v1/decrypt" && request.method() === "POST") {
      decryptBody = request.postDataJSON() as Record<string, unknown>;
      return json({
        message: "secret body",
        verified: true,
        verifyStatus: "valid",
        badgeKind: "good",
        badgeLabel: "✓",
        contactName: "Alice",
        isKnownContact: true,
        signerFingerprint: "ebp1alicefingerprint0000000000000000",
        signerEmail: "alice@example.com",
        signerEmailVerified: true,
        signerMatchesSenderEmail: true,
        messageFrom: "Alice <alice@example.com>",
        matchedEmailPath: "email",
      });
    }
    if (request.method() === "POST") return json({ ok: true });
    if (request.method() === "GET") return json({});
    return route.fulfill({ status: 404, body: "not mocked" });
  });

  return {
    decryptBody: () => decryptBody,
  };
}

test("locked reader hides armor until decrypt, then shows body, badge, and technical details", async ({ page }) => {
  const sent = await mockBackend(page);
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Mail" }).click();
  await expect(page.getByRole("heading", { name: "Mail", exact: true })).toBeVisible();

  await expect(page.locator("#mail-message-list")).toContainText("Encrypted hello");
  await page.locator("#mail-message-list li", { hasText: "Encrypted hello" }).click();

  await expect(page.locator("#mail-reader-locked")).toBeVisible();
  await expect(page.locator("#mail-reader-locked")).toContainText("This message is encrypted");
  await expect(page.locator("#mail-message-body")).toBeHidden();
  await expect(page.locator("#mail-message-body")).toHaveValue("");
  await expect(page.locator("#mail-technical-armor")).toBeHidden();
  await expect(page.locator("#mail-authenticity-badge")).toBeHidden();

  await page.locator("#mail-decrypt-btn").click();

  await expect(page.locator("#mail-reader-locked")).toBeHidden();
  await expect(page.locator("#mail-message-body")).toBeVisible();
  await expect(page.locator("#mail-message-body")).toHaveValue("secret body");
  await expect(page.locator("#mail-message-body")).not.toHaveValue(/BEGIN EBP/);
  const badge = page.locator("#mail-authenticity-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toContainText("Verified sender");
  expect(sent.decryptBody()?.password).toBeUndefined();
  expect(sent.decryptBody()?.payload).toMatchObject(ENCRYPTED_PAYLOAD);

  await badge.click();
  const modal = page.locator("#mail-authenticity-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Alice");
  await expect(page.locator("#mail-authenticity-fingerprint")).toContainText("ebp1alice");
  await page.locator("#mail-authenticity-close").click();
  await expect(modal).toBeHidden();

  await page.locator("#mail-technical-details summary").click();
  await expect(page.locator("#mail-technical-armor")).toBeVisible();
  await expect(page.locator("#mail-technical-armor")).toHaveValue(ARMOR);
});
