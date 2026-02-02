import { expect, test } from "@playwright/test";

test("loads the GUI shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/EBP Local GUI/);
  await expect(page.getByRole("heading", { name: "EBP" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Identities", exact: true }),
  ).toBeVisible();
});

test("navigates to Project Info", async ({ page }) => {
  await page.goto("/");

  await page.locator(".nav-item", { hasText: "Project Info" }).click();
  await expect(
    page.getByRole("heading", { name: "Project Info", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What is EBP?", exact: true }),
  ).toBeVisible();
});

test("navigates to Contacts", async ({ page }) => {
  await page.goto("/");

  await page.locator(".nav-item", { hasText: "Contacts" }).click();
  await expect(
    page.getByRole("heading", { name: "Contacts", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Known Contacts", exact: true }),
  ).toBeVisible();
});

test("navigates to Sign / Verify", async ({ page }) => {
  await page.goto("/");

  await page.locator(".nav-item", { hasText: "Sign / Verify" }).click();
  await expect(
    page.getByRole("heading", { name: "Sign / Verify", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign Message", exact: true }),
  ).toBeVisible();
});

test("navigates to Encrypt / Decrypt", async ({ page }) => {
  await page.goto("/");

  await page.locator(".nav-item", { hasText: "Encrypt / Decrypt" }).click();
  await expect(
    page.getByRole("heading", { name: "Encrypt / Decrypt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Encrypt Message", exact: true }),
  ).toBeVisible();
});

test("navigates to Settings", async ({ page }) => {
  await page.goto("/");

  await page.locator(".nav-item", { hasText: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Server Configuration", exact: true }),
  ).toBeVisible();
});

