import { expect, type Page, type Route, test } from "@playwright/test";
import { generateHumanName } from "./name_generator.ts";

const testPassword = "Onboard-test-password1";
const testServerUrl = "http://localhost:8788";
const DOMAIN = "pqpost.test";

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

async function setServer(page: Page) {
  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expandSection(page, "Server Configuration");
  await page.fill("#server-url", testServerUrl);
  await page.getByRole("button", { name: "Set Server", exact: true }).click();
  await expect(page.locator("#status")).toHaveAttribute("data-kind", "success");
}

function corsHeaders(route: Route): Record<string, string> {
  return {
    "access-control-allow-origin": route.request().headers()["origin"] ?? "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type, x-ebp-csrf",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  };
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  if (route.request().method() === "OPTIONS") {
    return route.fulfill({ status: 204, headers: corsHeaders(route) });
  }
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: corsHeaders(route),
    body: JSON.stringify(body),
  });
}

test("onboarding wizard creates keys, publishes, and provisions an EBP mailbox", async ({ page }) => {
  test.setTimeout(120_000);
  const username = generateHumanName().toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "wizard";
  let signupBody: Record<string, unknown> | null = null;

  await page.route("**/api/v1/mail/ebp-signup/config**", (route) =>
    fulfillJson(route, {
      server: testServerUrl,
      enabled: true,
      domain: DOMAIN,
      imap: { host: `mail.${DOMAIN}`, port: 993, secure: true },
      smtp: { host: `mail.${DOMAIN}`, port: 465, secure: true },
    }));
  await page.route("**/api/v1/mail/ebp-signup/username**", (route) => {
    const u = new URL(route.request().url()).searchParams.get("u") ?? "";
    return fulfillJson(route, u === "taken"
      ? { available: false, username: u, reason: "That address is taken." }
      : { available: true, username: u, email: `${u}@${DOMAIN}` });
  });
  await page.route("**/api/v1/mail/ebp-signup", async (route) => {
    if (route.request().method() === "OPTIONS") return fulfillJson(route, {});
    signupBody = route.request().postDataJSON();
    return fulfillJson(route, {
      ok: true,
      email: `${username}@${DOMAIN}`,
      fingerprint: "ebpdk1mockedfingerprint",
      accountId: "mail-mock",
      connection: {
        imap: { host: `mail.${DOMAIN}`, port: 993, secure: true },
        smtp: { host: `mail.${DOMAIN}`, port: 465, secure: true },
        login: `${username}@${DOMAIN}`,
        password: "0123456789abcdef0123456789abcdef",
      },
    });
  });

  await page.goto("/");
  await setServer(page);
  await page.locator(".nav-item", { hasText: "Identities" }).click();
  await page.locator("#identities-open-onboarding").click();

  const modal = page.locator("#onboarding-modal");
  await expect(modal).toBeVisible();
  await expect(page.locator("#onboarding-start")).toBeEnabled();
  await page.locator("#onboarding-start").click();

  await expect(page.locator("#onboarding-domain")).toHaveText(`@${DOMAIN}`);
  await page.fill("#onboarding-username", "taken");
  await expect(page.locator("#onboarding-username-hint")).toContainText("taken");
  await expect(page.locator("#onboarding-address-next")).toBeDisabled();
  await page.fill("#onboarding-username", "ab");
  await expect(page.locator("#onboarding-username-hint")).toContainText("at least 3");
  await page.fill("#onboarding-username", username);
  await expect(page.locator("#onboarding-username-hint")).toContainText("is available");
  await page.locator("#onboarding-address-next").click();

  await page.fill("#onboarding-password", testPassword);
  await page.fill("#onboarding-password-confirm", "mismatch");
  await page.locator("#onboarding-password-next").click();
  await expect(page.locator("#onboarding-password-hint")).toContainText("match");
  await page.fill("#onboarding-password-confirm", testPassword);
  await page.locator("#onboarding-password-next").click();

  await expect(page.locator("#onboarding-words li")).toHaveCount(24, { timeout: 15_000 });
  const words = await page.locator("#onboarding-words li").evaluateAll((items) =>
    items.map((li) => li.childNodes[1]?.textContent ?? "")
  );
  expect(words).toHaveLength(24);
  await page.locator("#onboarding-phrase-next").click();

  const quizInputs = page.locator("#onboarding-quiz input");
  await expect(quizInputs).toHaveCount(3);
  for (const input of await quizInputs.all()) {
    await input.fill("wrong");
  }
  await page.locator("#onboarding-create").click();
  await expect(page.locator("#onboarding-quiz-hint")).toContainText("don't match");
  for (const input of await quizInputs.all()) {
    const index = Number(await input.getAttribute("data-quiz-index"));
    await input.fill(words[index]);
  }
  await page.locator("#onboarding-create").click();

  await expect(page.locator('[data-step="done"]')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator("#onboarding-result-email")).toHaveText(`${username}@${DOMAIN}`);
  expect(signupBody).not.toBeNull();
  expect(signupBody!.username).toBe(username);
  expect(signupBody!.server).toBe(testServerUrl);
  expect(signupBody!.identity).toBeTruthy();

  await page.locator(".onboarding-connection summary").click();
  await expect(page.locator("#onboarding-connection")).toContainText(`mail.${DOMAIN}:993`);

  await page.locator("#onboarding-open-inbox").click();
  await expect(modal).toBeHidden();
  await expect(page.locator("#page-mail")).toHaveClass(/active/);
  await expect(page.locator("#identity-list")).toContainText(username);
});
