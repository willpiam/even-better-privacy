import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import process from "node:process";

type TestMailAccount = {
  email: string;
  password: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
};

type TestMailConfig = {
  accountOne: TestMailAccount;
  accountTwo: TestMailAccount;
  missingVars: string[];
};

const MAIL_PIN = "246810";
const IDENTITY_PASSWORD = "smoke-test-password";
const TEST_SERVER_URL = "http://localhost:8788";

function readEnv(name: string): string {
  const raw = process.env[name];
  if (!raw) return "";
  const trimmed = raw.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function readEnvPort(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return fallback;
  return parsed;
}

function getMailConfig(): TestMailConfig {
  const accountOne: TestMailAccount = {
    email: readEnv("TEST_EMAIL_ONE"),
    password: readEnv("TEST_EMAIL_ONE_PWORD"),
    smtpHost: readEnv("TEST_EMAIL_ONE_SMTP_HOST"),
    smtpPort: readEnvPort("TEST_EMAIL_ONE_SMTP_PORT", 465),
    imapHost: readEnv("TEST_EMAIL_ONE_IMAP_HOST"),
    imapPort: readEnvPort("TEST_EMAIL_ONE_IMAP_PORT", 993),
  };
  const accountTwo: TestMailAccount = {
    email: readEnv("TEST_EMAIL_TWO"),
    password: readEnv("TEST_EMAIL_TWO_PWORD"),
    smtpHost: readEnv("TEST_EMAIL_TWO_SMTP_HOST"),
    smtpPort: readEnvPort("TEST_EMAIL_TWO_SMTP_PORT", 465),
    imapHost: readEnv("TEST_EMAIL_TWO_IMAP_HOST"),
    imapPort: readEnvPort("TEST_EMAIL_TWO_IMAP_PORT", 993),
  };

  const missingVars = [
    ["TEST_EMAIL_ONE", accountOne.email],
    ["TEST_EMAIL_ONE_PWORD", accountOne.password],
    ["TEST_EMAIL_ONE_SMTP_HOST", accountOne.smtpHost],
    ["TEST_EMAIL_ONE_IMAP_HOST", accountOne.imapHost],
    ["TEST_EMAIL_TWO", accountTwo.email],
    ["TEST_EMAIL_TWO_PWORD", accountTwo.password],
    ["TEST_EMAIL_TWO_SMTP_HOST", accountTwo.smtpHost],
    ["TEST_EMAIL_TWO_IMAP_HOST", accountTwo.imapHost],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return { accountOne, accountTwo, missingVars };
}

async function goToMailPage(page: Page) {
  await page.goto("/");
  await page.locator(".nav-item", { hasText: "Mail" }).click();
  await expect(page.getByRole("heading", { name: "Mail", exact: true })).toBeVisible();
}

async function expandSection(page: Page, sectionTitle: string) {
  const toggle = page
    .locator(".page.active section > .section-toggle", {
      has: page.getByRole("heading", { name: sectionTitle, exact: true }),
    })
    .first();
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

async function expandMailSection(page: Page, sectionTitle: string) {
  const toggle = page.getByRole("button", { name: sectionTitle, exact: true }).first();
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}

async function submitIdentityPassword(page: Page, password = IDENTITY_PASSWORD) {
  const modal = page.locator("#password-modal");
  await expect(modal).toBeVisible();
  await page.fill("#password-modal-input", password);
  await page.getByRole("button", { name: "Submit", exact: true }).click();
}

async function submitPasswordModalIfVisible(page: Page, password: string) {
  const modal = page.locator("#password-modal");
  if (await modal.isVisible()) {
    await page.fill("#password-modal-input", password);
    await page.getByRole("button", { name: "Submit", exact: true }).click();
  }
}

async function createMailAccount(
  page: Page,
  accountName: string,
  account: TestMailAccount,
  pin: string,
) {
  await expandMailSection(page, "Account Setup (Local Device)");
  await page.getByRole("button", { name: "New Account", exact: true }).click();
  await page.fill("#mail-account-name", accountName);
  await page.fill("#mail-imap-host", account.imapHost);
  await page.fill("#mail-imap-port", String(account.imapPort));
  await page.fill("#mail-smtp-host", account.smtpHost);
  await page.fill("#mail-smtp-port", String(account.smtpPort));
  await page.fill("#mail-username", account.email);
  await page.fill("#mail-from-email", account.email);
  await page.fill("#mail-from-name", accountName);
  await page.fill("#mail-imap-password", account.password);
  await page.fill("#mail-smtp-password", account.password);
  await page.locator("#mail-persist-secrets").setChecked(true);
  await page.getByRole("button", { name: "Save Mail Account", exact: true }).click();
  await submitPasswordModalIfVisible(page, pin);
  await expect(page.locator("#status")).toContainText(/Mail account saved/i);
  await expect(page.locator("#mail-account-select")).toContainText(accountName);
}

async function selectAccount(page: Page, accountName: string) {
  await expandMailSection(page, "Account Setup (Local Device)");
  await page.locator("#mail-account-select").selectOption({ label: accountName });
  await expect(page.locator("#status")).toContainText(/Mail account selected/i);
}

async function sendEncryptedEmail(
  page: Page,
  to: string,
  subject: string,
  body: string,
  recipientFingerprint: string,
) {
  await expandMailSection(page, "Compose");
  await page.selectOption("#mail-compose-mode", "ebp-encrypt");
  await page.fill("#mail-compose-to", to);
  await page.fill("#mail-compose-subject", subject);
  await page.fill("#mail-compose-body", body);
  await page.fill("#mail-compose-recipient", recipientFingerprint);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Send Email", exact: true }).click();
  await submitIdentityPassword(page);
  await expect(page.locator("#status")).toContainText(/Email sent/i);
}

async function unlockMailSecrets(request: APIRequestContext, pin: string) {
  const unlockRes = await request.post("/api/v1/mail/unlock", {
    data: { pin },
  });
  expect(unlockRes.ok()).toBeTruthy();
}

async function cleanupAccountsByName(
  request: APIRequestContext,
  accountNames: string[],
  pin: string,
) {
  const listRes = await request.get("/api/v1/mail/accounts");
  if (!listRes.ok()) return;
  const listJson = await listRes.json() as {
    accounts?: Array<{ id?: string; name?: string }>;
  };
  const accounts = listJson.accounts ?? [];

  for (const accountName of accountNames) {
    const match = accounts.find((entry) => entry.name === accountName && entry.id);
    if (!match?.id) continue;

    let delRes = await request.post("/api/v1/mail/account/delete", {
      data: { accountId: match.id },
    });
    if (delRes.status() === 401) {
      await unlockMailSecrets(request, pin);
      delRes = await request.post("/api/v1/mail/account/delete", {
        data: { accountId: match.id },
      });
    }
    if (!delRes.ok() && delRes.status() !== 404) {
      const bodyText = await delRes.text().catch(() => "");
      console.warn(`mail account cleanup failed for ${accountName}: ${delRes.status()} ${bodyText}`);
    }
  }
}

async function seedIdentityDir(request: APIRequestContext, identityName: string) {
  const createRes = await request.post("/api/v1/identity/generate", {
    data: {
      name: identityName,
      signingType: "dilithium",
      encryptionType: "kyber",
      password: IDENTITY_PASSWORD,
      force: true,
    },
  });
  expect(createRes.ok()).toBeTruthy();
}

async function generateIdentity(page: Page, identityName: string, password = IDENTITY_PASSWORD) {
  await page.goto("/");
  await expandSection(page, "Create New Identity");
  await page.fill("#gen-name", identityName);
  await page.getByRole("button", { name: "Generate Identity", exact: true }).click();
  await submitIdentityPassword(page, password);
  await expect(page.locator("#identity-list")).toContainText(identityName);
}

async function setServer(page: Page, serverUrl = TEST_SERVER_URL) {
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expandSection(page, "Server Configuration");
  await page.fill("#server-url", serverUrl);
  await page.getByRole("button", { name: "Set Server", exact: true }).click();
}

async function publishIdentity(page: Page, serverUrl = TEST_SERVER_URL, password = IDENTITY_PASSWORD) {
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Publish to Server");
  await page.fill("#publish-server", serverUrl);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await submitIdentityPassword(page, password);
}

async function addDetail(
  page: Page,
  path: string,
  detail: string,
  password = IDENTITY_PASSWORD,
  push = true,
) {
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Identity Details");
  await page.fill("#detail-path", path);
  await page.fill("#detail-value", detail);
  await page.locator("#detail-push").setChecked(push);
  await page.getByRole("button", { name: "Add Detail", exact: true }).click();
  await submitIdentityPassword(page, password);
}

async function currentFingerprint(page: Page): Promise<string> {
  const fp = (await page.locator("#ctx-fingerprint").textContent())?.trim() ?? "";
  expect(fp).toBeTruthy();
  return fp;
}

async function ensureIdentitySelected(page: Page, identityName: string) {
  const currentIdentity = (await page.locator("#ctx-current").textContent())?.trim();
  if (currentIdentity === identityName) return;
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await expandSection(page, "Your Identities");
  await expect(page.locator("#identity-list")).toContainText(identityName);
  await page.locator("#identity-list li", { hasText: identityName }).click();
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator("#ctx-current")).toHaveText(identityName);
}

async function importContactFromServer(page: Page, search: string, contactFingerprint: string) {
  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expandSection(page, "Browse Server Identities");
  await page.fill("#server-identities-override", TEST_SERVER_URL);
  await page.fill("#server-identities-search", search);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.getByRole("button", { name: "Load from Server", exact: true }).click();
    const listText = await page.locator("#server-identities-list").innerText();
    if (listText.includes(contactFingerprint)) break;
    await page.waitForTimeout(500);
  }
  const contactEntry = page.locator("#server-identities-list .server-identity-item", {
    hasText: contactFingerprint,
  });
  await contactEntry.getByRole("button", { name: "Import as Contact", exact: true }).click();
  await expect(page.locator("#contacts-list")).toContainText(contactFingerprint);
}

async function getAccountIdByName(request: APIRequestContext, accountName: string): Promise<string | null> {
  const listRes = await request.get("/api/v1/mail/accounts");
  if (!listRes.ok()) return null;
  const listJson = await listRes.json() as {
    accounts?: Array<{ id?: string; name?: string }>;
  };
  const match = (listJson.accounts ?? []).find((entry) => entry.name === accountName && entry.id);
  return match?.id ?? null;
}

async function waitForMessageDetailBySubject(
  request: APIRequestContext,
  accountId: string,
  subject: string,
): Promise<{ text: string; ebpPayload: Record<string, unknown> | null }> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const listRes = await request.get(
      `/api/v1/mail/messages?folder=INBOX&limit=30&accountId=${encodeURIComponent(accountId)}`,
    );
    if (listRes.ok()) {
      const listJson = await listRes.json() as {
        messages?: Array<{ uid?: number; subject?: string }>;
      };
      const match = (listJson.messages ?? []).find((msg) => msg.subject === subject && msg.uid);
      if (match?.uid) {
        const detailRes = await request.get(
          `/api/v1/mail/message?folder=INBOX&uid=${encodeURIComponent(String(match.uid))}&accountId=${encodeURIComponent(accountId)}`,
        );
        if (detailRes.ok()) {
          const detailJson = await detailRes.json() as {
            text?: string;
            html?: string;
            ebpPayload?: Record<string, unknown> | null;
          };
          const text = detailJson.text ?? detailJson.html ?? "";
          return { text, ebpPayload: detailJson.ebpPayload ?? null };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for message detail with subject: ${subject}`);
}

test("mail reader defaults to plaintext and can render HTML from settings", async ({ page }) => {
  const now = Date.now();
  const messageUid = 101;
  const htmlBody = `<h1>Rendered ${now}</h1><p>This is an html email body.</p><script>window.__mailScriptExecuted = true;</script>`;

  await page.route("http://127.0.0.1:8787/api/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (pathname === "/api/v1/health") {
      return json({ ok: true, protocolVersion: "test", componentVersion: "test" });
    }
    if (pathname === "/api/v1/context") {
      return json({
        identityDir: "/tmp/ebp-test",
        contactsDir: "/tmp/ebp-test/contacts",
        currentIdentity: null,
        server: null,
        protocolVersion: "test",
      });
    }
    if (pathname === "/api/v1/identities") {
      return json({ identities: [], currentIdentity: null });
    }
    if (pathname === "/api/v1/contacts") {
      return json({ contacts: [] });
    }
    if (pathname === "/api/v1/server/identities") {
      return json({ identities: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    }
    if (pathname === "/api/v1/mail/account") {
      return json({
        accountId: "mock-account",
        accountName: "Mock account",
        account: {
          gmailMode: false,
          imapHost: "imap.example.com",
          imapPort: 993,
          imapSecure: true,
          smtpHost: "smtp.example.com",
          smtpPort: 465,
          smtpSecure: true,
          username: "user@example.com",
          fromEmail: "user@example.com",
          fromName: "Mock User",
          persistSecrets: false,
        },
        selectedAccountId: "mock-account",
        accounts: [{ id: "mock-account", name: "Mock account" }],
        hasImapPassword: true,
        hasSmtpPassword: true,
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
          uid: messageUid,
          subject: "HTML Message",
          from: "Sender <sender@example.com>",
          to: "Recipient <recipient@example.com>",
          date: now,
          seen: false,
          size: 128,
        }],
      });
    }
    if (pathname === "/api/v1/mail/message") {
      return json({
        accountId: "mock-account",
        uid: messageUid,
        subject: "HTML Message",
        from: "Sender <sender@example.com>",
        to: "Recipient <recipient@example.com>",
        date: now,
        size: 128,
        text: "",
        html: htmlBody,
        attachments: [],
        ebpPayload: null,
      });
    }
    if (request.method() === "POST") {
      return json({ ok: true });
    }
    return route.fulfill({ status: 404, body: "not mocked" });
  });

  await goToMailPage(page);
  await page.locator("#mail-inbox-form button[type='submit']").click();
  await expect(page.locator("#mail-message-list")).toContainText("HTML Message");
  await page.locator("#mail-message-list li", { hasText: "HTML Message" }).click();

  await expect(page.locator("#mail-message-body-wrap")).toBeVisible();
  await expect(page.locator("#mail-message-body")).toHaveValue(/<h1>Rendered/);
  await expect(page.locator("#mail-message-html-wrap")).toBeHidden();

  await page.locator(".nav-item", { hasText: "Settings" }).click();
  const htmlToggle = page.locator("#settings-mail-render-html");
  await expect(htmlToggle).not.toBeChecked();
  await htmlToggle.check();
  await expect(htmlToggle).toBeChecked();

  await page.locator(".nav-item", { hasText: "Mail" }).click();
  await expect(page.locator("#mail-message-html-wrap")).toBeVisible();
  await expect(page.locator("#mail-message-body-wrap")).toBeHidden();
  const srcdoc = await page.locator("#mail-message-html-frame").getAttribute("srcdoc");
  expect(srcdoc ?? "").toContain("<h1>Rendered");
  expect(srcdoc ?? "").toContain("Content-Security-Policy");

  await page.reload();
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(page.locator("#settings-mail-render-html")).toBeChecked();
});

test("adds two mail accounts, sends encrypted mail between identities, decrypts, and removes test accounts", async ({
  page,
  request,
}) => {
  test.setTimeout(720_000);
  const config = getMailConfig();
  test.skip(
    config.missingVars.length > 0,
    `Missing required .env vars for mail e2e: ${config.missingVars.join(", ")}`,
  );

  const runId = Date.now();
  const identityName = `e2e-mail-seed-${runId}`;
  const senderIdentity = `e2e-mail-sender-${runId}`;
  const recipientIdentity = `e2e-mail-recipient-${runId}`;
  const accountOneLabel = `e2e-mail-one-${runId}`;
  const accountTwoLabel = `e2e-mail-two-${runId}`;
  const subject = `[EBP e2e encrypted ${runId}] account one to account two`;
  const body = `e2e mail body marker ${runId}`;

  await seedIdentityDir(request, identityName);
  await generateIdentity(page, senderIdentity);
  await setServer(page, TEST_SERVER_URL);
  await addDetail(page, "email", config.accountOne.email);
  await publishIdentity(page, TEST_SERVER_URL);
  const senderFingerprint = await currentFingerprint(page);

  await generateIdentity(page, recipientIdentity);
  await setServer(page, TEST_SERVER_URL);
  await addDetail(page, "email", config.accountTwo.email);
  await publishIdentity(page, TEST_SERVER_URL);
  const recipientFingerprint = await currentFingerprint(page);

  await ensureIdentitySelected(page, senderIdentity);
  await importContactFromServer(page, recipientFingerprint, recipientFingerprint);

  await ensureIdentitySelected(page, recipientIdentity);
  await importContactFromServer(page, senderFingerprint, senderFingerprint);

  await goToMailPage(page);
  try {
    await createMailAccount(page, accountOneLabel, config.accountOne, MAIL_PIN);
    await createMailAccount(page, accountTwoLabel, config.accountTwo, MAIL_PIN);

    await selectAccount(page, accountOneLabel);
    await ensureIdentitySelected(page, senderIdentity);
    await goToMailPage(page);
    await sendEncryptedEmail(page, config.accountTwo.email, subject, body, recipientFingerprint);

    const accountTwoId = await getAccountIdByName(request, accountTwoLabel);
    expect(accountTwoId).toBeTruthy();
    const accountTwoIdSafe = accountTwoId ?? "";
    const switchMailRes = await request.post("/api/v1/mail/account/select", {
      data: { accountId: accountTwoIdSafe },
    });
    expect(switchMailRes.ok()).toBeTruthy();
    const switchIdentityRes = await request.post("/api/v1/identity/use", {
      data: { name: recipientIdentity },
    });
    expect(switchIdentityRes.ok()).toBeTruthy();

    // Keep one visible UI account switch assertion in the flow.
    await goToMailPage(page);
    await selectAccount(page, accountTwoLabel);

    const detail = await waitForMessageDetailBySubject(request, accountTwoIdSafe, subject);
    expect(detail.text).toContain("-----BEGIN EBP MESSAGE-----");
    expect(detail.ebpPayload).toBeTruthy();

    const decryptRes = await request.post("/api/v1/decrypt", {
      data: {
        payload: detail.ebpPayload,
        password: IDENTITY_PASSWORD,
        sender: senderFingerprint,
        senderEmail: config.accountOne.email,
      },
    });
    expect(decryptRes.ok()).toBeTruthy();
    const decryptJson = await decryptRes.json() as {
      message?: string;
      verified?: boolean | null;
      verifyStatus?: string | null;
    };
    expect(decryptJson.message ?? "").toContain(body);
    expect(decryptJson.verified).toBe(true);
    expect((decryptJson.verifyStatus ?? "").toLowerCase()).toContain("valid");
  } finally {
    try {
      await cleanupAccountsByName(request, [accountOneLabel, accountTwoLabel], MAIL_PIN);
    } catch (err) {
      console.warn("mail account cleanup skipped due closed test context", err);
    }
  }
});

test("inbox search passes search param and filters displayed messages", async ({ page }) => {
  const now = Date.now();
  const allMessages = [
    { uid: 1, subject: "Meeting notes", from: "Alice <alice@example.com>", to: "Me <me@example.com>", date: now - 3000, seen: true, size: 200 },
    { uid: 2, subject: "Invoice #42", from: "Bob <bob@example.com>", to: "Me <me@example.com>", date: now - 2000, seen: false, size: 350 },
    { uid: 3, subject: "Hello world", from: "Carol <carol@example.com>", to: "Me <me@example.com>", date: now - 1000, seen: false, size: 100 },
  ];

  let lastSearchParam: string | null = null;

  await page.route("http://127.0.0.1:8787/api/v1/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    const json = (body: unknown) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

    if (pathname === "/api/v1/health") {
      return json({ ok: true, protocolVersion: "test", componentVersion: "test" });
    }
    if (pathname === "/api/v1/context") {
      return json({
        identityDir: "/tmp/ebp-test",
        contactsDir: "/tmp/ebp-test/contacts",
        currentIdentity: null,
        server: null,
        protocolVersion: "test",
      });
    }
    if (pathname === "/api/v1/identities") {
      return json({ identities: [], currentIdentity: null });
    }
    if (pathname === "/api/v1/contacts") {
      return json({ contacts: [] });
    }
    if (pathname === "/api/v1/server/identities") {
      return json({ identities: [], pagination: { page: 1, totalPages: 1, total: 0 } });
    }
    if (pathname === "/api/v1/mail/account") {
      return json({
        accountId: "mock-account",
        accountName: "Mock account",
        account: {
          gmailMode: false,
          imapHost: "imap.example.com",
          imapPort: 993,
          imapSecure: true,
          smtpHost: "smtp.example.com",
          smtpPort: 465,
          smtpSecure: true,
          username: "user@example.com",
          fromEmail: "user@example.com",
          fromName: "Mock User",
          persistSecrets: false,
        },
        selectedAccountId: "mock-account",
        accounts: [{ id: "mock-account", name: "Mock account" }],
        hasImapPassword: true,
        hasSmtpPassword: true,
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
      lastSearchParam = url.searchParams.get("search");
      const search = (lastSearchParam ?? "").toLowerCase();
      const filtered = search
        ? allMessages.filter(
            (m) =>
              m.subject.toLowerCase().includes(search) ||
              m.from.toLowerCase().includes(search),
          )
        : allMessages;
      return json({
        accountId: "mock-account",
        folder: "INBOX",
        messages: filtered,
      });
    }
    if (request.method() === "POST") {
      return json({ ok: true });
    }
    return route.fulfill({ status: 404, body: "not mocked" });
  });

  await goToMailPage(page);

  // Initial refresh without search – all messages shown
  await page.locator("#mail-inbox-form button[type='submit']").click();
  await expect(page.locator("#mail-message-list")).toContainText("Meeting notes");
  await expect(page.locator("#mail-message-list")).toContainText("Invoice #42");
  await expect(page.locator("#mail-message-list")).toContainText("Hello world");
  expect(lastSearchParam).toBeNull();

  // Type a search term and refresh – only matching message shown and param sent
  await page.fill("#mail-search", "invoice");
  await page.locator("#mail-inbox-form button[type='submit']").click();
  expect(lastSearchParam).toBe("invoice");
  await expect(page.locator("#mail-message-list")).toContainText("Invoice #42");
  await expect(page.locator("#mail-message-list")).not.toContainText("Meeting notes");
  await expect(page.locator("#mail-message-list")).not.toContainText("Hello world");

  // Search by sender
  await page.fill("#mail-search", "carol");
  await page.locator("#mail-inbox-form button[type='submit']").click();
  expect(lastSearchParam).toBe("carol");
  await expect(page.locator("#mail-message-list")).toContainText("Hello world");
  await expect(page.locator("#mail-message-list")).not.toContainText("Invoice #42");

  // Clear search – all messages shown again
  await page.fill("#mail-search", "");
  await page.locator("#mail-inbox-form button[type='submit']").click();
  expect(lastSearchParam).toBeNull();
  await expect(page.locator("#mail-message-list")).toContainText("Meeting notes");
  await expect(page.locator("#mail-message-list")).toContainText("Invoice #42");
  await expect(page.locator("#mail-message-list")).toContainText("Hello world");
});
