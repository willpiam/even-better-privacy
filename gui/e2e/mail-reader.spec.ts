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

// These tests exercise the real frontend with deterministic mail responses.
async function openResponsiveMail(page: Page) {
  await mockBackend(page);
  await page.route("**/api/v1/identity/unlock-status", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ unlocked: true }),
  }));
  await page.goto("/");
  await page.locator('.nav-item[data-page="mail"]').click();
  await expect(page.locator("#mail-message-list")).toContainText("Encrypted hello");
}

test("responsiveness: cached inbox renders while refresh is pending and survives failure", async ({ page }) => {
  await openResponsiveMail(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let refreshing = false;
  await page.route("**/api/v1/mail/messages?**", async (route) => {
    refreshing = true;
    await pending;
    await route.fulfill({ status: 502, contentType: "application/json", body: '{"error":"offline"}' });
  });
  await page.evaluate(() => {
    // Empty the DOM to prove cached data is rendered before the network returns.
    document.getElementById("mail-message-list")!.innerHTML = "";
    return import("/js/mail.js").then(({ loadMailMessages }) => {
      (window as any).refreshDone = loadMailMessages(1).catch(() => {});
    });
  });
  await expect.poll(() => refreshing).toBe(true);
  await expect(page.locator("#mail-message-list")).toContainText("Encrypted hello");
  release();
  await page.evaluate(() => (window as any).refreshDone);
  await expect(page.locator("#mail-message-list")).toContainText("Encrypted hello");
});

test("responsiveness: reopening uses body cache, refresh and lock invalidate it", async ({ page }) => {
  let requests = 0;
  page.on("request", (req) => { if (new URL(req.url()).pathname === "/api/v1/mail/message") requests++; });
  await openResponsiveMail(page);
  const message = page.locator("#mail-message-list li", { hasText: "Encrypted hello" });
  await message.click();
  await expect(page.locator("#mail-message-body")).toHaveValue("secret body");
  await message.click();
  await expect(page.locator("#mail-message-body")).toHaveValue("secret body");
  expect(requests).toBe(1);
  await page.locator('#mail-inbox-form button[type="submit"]').click();
  await message.click();
  await expect(page.locator("#mail-message-body")).toHaveValue("secret body");
  expect(requests).toBe(2);
  await page.evaluate(async () => { await (await import("/js/unlock.js")).lockIdentity(); });
  await expect(page.locator("#mail-message-body")).toHaveValue("");
  await page.evaluate(async () => {
    const { state } = await import("/js/state.js");
    return state.selectedMailDecryptResult;
  }).then((result) => expect(result).toBeNull());
  await page.evaluate(async () => { await (await import("/js/mail.js")).loadMailMessages(1); });
  await message.click();
  await expect.poll(() => requests).toBe(3);
});

test("responsiveness: late folder responses cannot replace the current inbox", async ({ page }) => {
  await openResponsiveMail(page);
  await page.evaluate(async () => {
    const nativeFetch = window.fetch.bind(window);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    // Deliberately ignore AbortSignal to exercise the request-id guard too.
    window.fetch = async (input, init) => {
      if (String(input).includes("/mail/messages?") && String(input).includes("folder=Sent")) {
        await gate;
        return new Response(JSON.stringify({ messages: [{ uid: 7, subject: "Late sent message" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return nativeFetch(input, init);
    };
    const { loadMailMessages } = await import("/js/mail.js");
    (document.getElementById("mail-folder") as HTMLSelectElement).value = "Sent";
    const sent = loadMailMessages(1);
    (document.getElementById("mail-folder") as HTMLSelectElement).value = "INBOX";
    await loadMailMessages(1);
    release();
    await sent;
    window.fetch = nativeFetch;
  });
  await expect(page.locator("#mail-message-list")).toContainText("Encrypted hello");
  await expect(page.locator("#mail-message-list")).not.toContainText("Late sent message");
});

test("responsiveness: cache expires, evicts least recently used entries and bounds large bodies", async ({ page }) => {
  await openResponsiveMail(page);
  const result = await page.evaluate(async () => {
    const { createMailCache } = await import("/js/mail-cache.js");
    const cache = createMailCache(2, 100, 1000);
    cache.set("a", "A"); cache.set("b", "B"); cache.get("a"); cache.set("c", "C");
    const evicted = cache.get("b") === undefined && cache.get("a") === "A";
    cache.set("huge", "x".repeat(100));
    const bounded = cache.get("huge") === undefined;
    const now = Date.now;
    Date.now = () => now() + 1001;
    const expired = cache.get("a") === undefined;
    Date.now = now;
    return { evicted, bounded, expired };
  });
  expect(result).toEqual({ evicted: true, bounded: true, expired: true });
});

test("responsiveness: lock rejects in-flight message data and clears it from the cache", async ({ page }) => {
  await openResponsiveMail(page);
  const result = await page.evaluate(async () => {
    const nativeFetch = window.fetch.bind(window);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    window.fetch = async (input, init) => {
      if (String(input).includes("/mail/message?")) {
        await gate;
        return new Response(JSON.stringify({ uid: 7, subject: "Late private message", text: "private" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return nativeFetch(input, init);
    };
    const { openMailMessage } = await import("/js/mail.js");
    const { lockIdentity } = await import("/js/unlock.js");
    const { state } = await import("/js/state.js");
    const { mailCacheScope, mailBodyCache } = await import("/js/mail-cache.js");
    const scope = mailCacheScope();
    const pending = openMailMessage("INBOX", 7);
    await lockIdentity();
    release();
    await pending;
    window.fetch = nativeFetch;
    return {
      selected: state.selectedMailMessage,
      cached: mailBodyCache.get(JSON.stringify([scope, "INBOX", "7"])) ?? null,
    };
  });
  expect(result).toEqual({ selected: null, cached: null });
  await expect(page.locator("#mail-message-body")).toHaveValue("");
});

test("responsiveness: account changes isolate messages with the same UID", async ({ page }) => {
  await openResponsiveMail(page);
  await page.locator("#mail-message-list li", { hasText: "Encrypted hello" }).click();
  await expect(page.locator("#mail-message-body")).toHaveValue("secret body");
  await page.route("**/api/v1/mail/account", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ selectedAccountId: "second-account", accounts: [] }),
  }));
  await page.route("**/api/v1/mail/message?**", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ uid: 7, text: "Second account body" }),
  }));
  await page.evaluate(async () => {
    const { loadMailAccount, openMailMessage } = await import("/js/mail.js");
    await loadMailAccount();
    await openMailMessage("INBOX", 7);
  });
  await expect(page.locator("#mail-message-body")).toHaveValue("Second account body");
});
