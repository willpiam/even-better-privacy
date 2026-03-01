import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

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

async function expandMailSection(page: Page, sectionTitle: string) {
  const toggle = page.getByRole("button", { name: sectionTitle, exact: true }).first();
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
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
  await page.selectOption("#mail-account-select", { label: accountName });
  await expect(page.locator("#status")).toContainText(/Mail account selected/i);
}

async function sendPlaintextEmail(
  page: Page,
  to: string,
  subject: string,
  body: string,
) {
  await expandMailSection(page, "Compose");
  await page.selectOption("#mail-compose-mode", "plain");
  await page.fill("#mail-compose-to", to);
  await page.fill("#mail-compose-subject", subject);
  await page.fill("#mail-compose-body", body);
  await page.getByRole("button", { name: "Send Email", exact: true }).click();
  await expect(page.locator("#status")).toContainText(/Email sent/i);
}

async function waitForInboxMessage(page: Page, subject: string) {
  await expandMailSection(page, "Inbox");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    const messageList = page.locator("#mail-message-list");
    if (await messageList.innerText().then((text) => text.includes(subject)).catch(() => false)) {
      break;
    }
    await page.waitForTimeout(1500);
  }

  await expect(page.locator("#mail-message-list")).toContainText(subject);
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

async function getAccountIdByName(request: APIRequestContext, accountName: string): Promise<string | null> {
  const listRes = await request.get("/api/v1/mail/accounts");
  if (!listRes.ok()) return null;
  const listJson = await listRes.json() as {
    accounts?: Array<{ id?: string; name?: string }>;
  };
  const match = (listJson.accounts ?? []).find((entry) => entry.name === accountName && entry.id);
  return match?.id ?? null;
}

async function waitForMessageBodyBySubject(
  request: APIRequestContext,
  accountId: string,
  subject: string,
): Promise<string> {
  for (let attempt = 0; attempt < 24; attempt += 1) {
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
          const detailJson = await detailRes.json() as { text?: string; html?: string };
          const text = detailJson.text ?? detailJson.html ?? "";
          if (text) return text;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for message with subject: ${subject}`);
}

test.only("adds two mail accounts, sends mail between them, verifies receipt, and removes test accounts", async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const config = getMailConfig();
  test.skip(
    config.missingVars.length > 0,
    `Missing required .env vars for mail e2e: ${config.missingVars.join(", ")}`,
  );

  const runId = Date.now();
  const identityName = `e2e-mail-seed-${runId}`;
  const accountOneLabel = `e2e-mail-one-${runId}`;
  const accountTwoLabel = `e2e-mail-two-${runId}`;
  const subject = `[EBP e2e ${runId}] account one to account two`;
  const body = `e2e mail body marker ${runId}`;

  await seedIdentityDir(request, identityName);
  await goToMailPage(page);
  try {
    await createMailAccount(page, accountOneLabel, config.accountOne, MAIL_PIN);
    await createMailAccount(page, accountTwoLabel, config.accountTwo, MAIL_PIN);

    await selectAccount(page, accountOneLabel);
    await sendPlaintextEmail(page, config.accountTwo.email, subject, body);

    await selectAccount(page, accountTwoLabel);
    await waitForInboxMessage(page, subject);
    const accountTwoId = await getAccountIdByName(request, accountTwoLabel);
    expect(accountTwoId).toBeTruthy();
    const receivedBody = await waitForMessageBodyBySubject(request, accountTwoId ?? "", subject);
    expect(receivedBody).toContain(body);
  } finally {
    await cleanupAccountsByName(request, [accountOneLabel, accountTwoLabel], MAIL_PIN);
  }
});
