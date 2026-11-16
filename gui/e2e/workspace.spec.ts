import { expect, test, type Page } from "@playwright/test";

// Exercise the real UI with deterministic local responses; no mail is sent.
async function mockWorkspace(page: Page) {
  let currentIdentity = "Personal";
  const uses: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body: unknown) => route.fulfill({
      contentType: "application/json", body: JSON.stringify(body),
    });
    switch (url.pathname) {
      case "/api/v1/health": return json({ ok: true });
      case "/api/v1/csrf-token": return json({ token: "workspace-test" });
      case "/api/v1/context": return json({ currentIdentity, server: null, protocolVersion: "test", identityDirLabel: "~/.ebp" });
      case "/api/v1/identities": return json({
        currentIdentity,
        identities: [
          { name: "Personal", fingerprint: "ebp1personal" },
          { name: "Work", fingerprint: "ebp1work" },
        ],
      });
      case "/api/v1/identity/public": return json({ available: false });
      case "/api/v1/identity/unlock-status": return json({ unlocked: true });
      case "/api/v1/identity/use":
        currentIdentity = request.postDataJSON().name;
        uses.push(currentIdentity);
        return json({ ok: true });
      case "/api/v1/contacts": return json({ contacts: [
        { name: "Alice", localAlias: "Ally", fingerprint: "ebp1alice", signingKeyType: "dilithium", encryptionKeyType: "kyber", details: { email: ["alice@example.com", "proof"] } },
        { name: "Bob", fingerprint: "ebp1bob", signingKeyType: "dilithium", encryptionKeyType: "kyber", details: { email: ["bob@example.com", "proof"] } },
      ] });
      case "/api/v1/mail/ebp-signup/config": return json({ enabled: false });
      case "/api/v1/mail/account": return json({
        selectedAccountId: "test", accountId: "test", accountName: "Test mailbox",
        secretsInMemory: true, secretsLocked: false,
        accounts: [{ id: "test", name: "Test mailbox" }],
        account: { username: "me@example.com", fromEmail: "me@example.com", persistSecrets: false },
      });
      case "/api/v1/mail/accounts": return json({ accounts: [] });
      case "/api/v1/mail/messages": return json({
        accountId: "test", folder: url.searchParams.get("folder"),
        messages: [{ uid: 1, subject: "A quiet conversation", from: "Alice <alice@example.com>", to: "me@example.com", date: Date.now(), seen: false }],
        pagination: { page: 1, totalPages: 1, total: 1 },
      });
      case "/api/v1/mail/message": return json({
        accountId: "test", uid: 1, subject: "A quiet conversation", from: "Alice <alice@example.com>",
        to: "me@example.com", date: Date.now(), text: "Hello from the garden.", attachments: [],
      });
      default: return json({});
    }
  });
  return { uses };
}

test.beforeEach(async ({ page }) => {
  await mockWorkspace(page);
});

test("appearance persists and follows the system when requested", async ({ page }) => {
  await page.goto("/#settings");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#settings-appearance").selectOption("dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#settings-appearance")).toHaveValue("dark");
  await page.locator('[data-page="contacts"]').click();
  await expect(page.locator("body")).toHaveAttribute("data-place", "contacts");
  expect(await page.locator("body").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(38, 31, 32)");
  expect(await page.locator("#contact-json").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(48, 40, 42)");
  await page.locator('[data-page="settings"]').click();
  await page.emulateMedia({ colorScheme: "light" });
  await page.locator("#settings-appearance").selectOption("system");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("tool shortcuts reveal every message and file workflow", async ({ page }) => {
  await page.goto("/#tools");
  const targets = ["encrypt-form", "decrypt-form", "sign-form", "verify-form", "encrypt-file-form", "decrypt-file-form", "sign-file-form", "verify-file-form"];
  for (const target of targets) {
    await page.locator('[data-page="tools"]').click();
    const link = page.locator(`[data-tool-target="${target}"]`);
    await link.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`#${target}`)).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-place", "tools");
  }
});

test("contact search finds aliases, email addresses, and fingerprints", async ({ page }) => {
  await page.goto("/#contacts");
  const rows = page.locator("#contacts-list .contact-item:visible");
  await expect(rows).toHaveCount(2);
  const search = page.getByRole("searchbox", { name: "Search contacts" });
  for (const query of ["Ally", "alice@example.com", "ebp1alice"]) {
    await search.fill(query);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Alice");
  }
  await search.fill("Nobody");
  await expect(rows).toHaveCount(0);
  await expect(page.locator("#contacts-search-empty")).toBeVisible();
  await page.getByRole("button", { name: "Clear contact search" }).click();
  await expect(rows).toHaveCount(2);
  await expect(search).toBeFocused();
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#contact-detail-modal")).toBeVisible();
});

test("fingerprint copy works from the relocated system information", async ({ page }) => {
  await page.route("**/api/v1/identity/public", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ available: true, fingerprint: "ebp1personal", details: [] }),
  }));
  await page.goto("/#settings");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async (value: string) => { (window as any).copiedFingerprint = value; },
    } });
  });
  await page.getByRole("button", { name: "System Information", exact: true }).click();
  await page.locator("#copy-fingerprint-btn svg").click();
  await expect(page.getByRole("button", { name: "Fingerprint copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).copiedFingerprint)).toBe("ebp1personal");
});

test("keyboard identity switching keeps the shared identity context in sync", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#identity-list")).toContainText("Personal");
  await page.getByRole("button", { name: "Use identity Work", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#confirm-modal")).toBeVisible();
  await expect(page.locator("#ctx-current")).toHaveText("Personal");
  await page.getByRole("button", { name: "Switch", exact: true }).click();
  await expect(page.locator("#ctx-current")).toHaveText("Work");
  await expect(page.locator("#workspace-profile-name")).toHaveText("Work");
  await expect(page.locator("#identity-list .current")).toContainText("Work");
});

test("narrow mail supports list, reader, back, and compose without losing context", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto("/#mail");
  await expect(page.locator("#mail-message-list")).toContainText("A quiet conversation");
  await page.locator("#mail-message-list .mail-message-item").click();
  await expect(page.locator("#mail-message-body")).toHaveValue("Hello from the garden.");
  await expect(page.locator("#mail-security-line")).toContainText("Not end-to-end encrypted");
  await expect(page.locator(".mail-list-panel")).toBeHidden();
  await page.getByRole("button", { name: "Back to messages" }).click();
  await expect(page.locator(".mail-list-panel")).toBeVisible();
  await expect(page.locator(".mail-reader-panel")).toBeHidden();
  await page.locator('[data-open-mail-tab="compose"]').click();
  await expect(page.locator("#mail-compose-to-input")).toBeFocused();
  await expect(page.locator("body")).toHaveAttribute("data-place", "compose");
  await expect(page.locator('[data-mail-tab="compose"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-mail-tab="compose"]').focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-mail-tab="sent"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("body")).toHaveAttribute("data-place", "mail");
});

test("all workspaces fit the minimum desktop window and a narrow browser", async ({ page }) => {
  await page.goto("/");
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    for (const name of ["identities", "contacts", "tools", "certificates", "sign-verify", "encrypt-decrypt", "settings", "project-info", "mail"]) {
      await page.goto(`/#${name}`);
      await expect(page.locator(`#page-${name}`)).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, `${name} overflows at ${width}px`).toBe(false);
    }
  }
});

test("operation artwork follows real work and honors reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/verify", async (route) => {
    await pending;
    await route.fulfill({ contentType: "application/json", body: '{"verified":true}' });
  });
  await page.goto("/#tools");
  await page.locator('[data-tool-target="verify-form"]').click();
  await page.locator("#verify-payload").fill('{"type":"ebp-signed-message","signature":"test"}');
  const submit = page.locator('#verify-form button[type="submit"]');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(page.locator("#verify-form .fox-progress")).toContainText("Checking the signature");
  expect(await page.locator("#verify-form .fox-loop").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  release();
  await expect(page.locator("#verify-result")).toContainText("Valid");
  await expect(page.locator("#verify-form .fox-progress")).toHaveCount(0);
  await expect(submit).toBeEnabled();
});
