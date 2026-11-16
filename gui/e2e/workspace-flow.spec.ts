import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { completePrivateOperation } from "./private-operation.ts";

test.use({ actionTimeout: 10_000 });

async function openTool(page: Page, form: string) {
  await page.locator('.nav-item[data-page="tools"]').click();
  await page.locator(`[data-tool-target="${form}"]`).click();
}

async function output(page: Page, id: string) {
  const field = page.locator(`#${id}`);
  await expect(field).not.toHaveValue("", { timeout: 30_000 });
  return field.inputValue();
}

async function pickContact(page: Page, field: string, name: string) {
  await page.locator(`#${field}`).fill(name);
  await page.locator(`#${field}-dropdown .contact-search-item`).filter({ hasText: name }).first().click();
  await expect(page.locator(`#${field}-dropdown`)).toBeHidden();
}

test("new workspace completes real identity, message, and file workflows", async ({ page }) => {
  test.setTimeout(120_000);
  const name = `desktop-ux-${Date.now()}`;
  const contact = `${name}-contact`;
  const password = "Desktop-workspace-test1!";
  const message = "A private conversation from the new desktop workspace.";
  const file = { name: `${name}.txt`, mimeType: "text/plain", buffer: Buffer.from(message) };

  await page.goto("/#identities");
  await page.getByRole("button", { name: "New identity", exact: true }).click();
  await page.locator("#gen-name").fill(name);
  await page.getByRole("button", { name: "Generate Identity", exact: true }).click();
  await expect(page.locator("#password-modal")).toBeVisible();
  await page.locator("#password-modal-input").fill(password);
  await page.locator("#password-modal-confirm").click();
  await expect(page.locator("#identity-list")).toContainText(name, { timeout: 30_000 });
  await expect(page.locator("#ctx-current")).toHaveText(name);
  await expect(page.locator('#generate-form button[type="submit"]')).toBeEnabled();

  if (await page.locator("#ctx-unlock-pill").getAttribute("data-state") !== "unlocked") {
    await page.locator("#ctx-unlock-btn").click();
    await page.locator("#password-modal-input").fill(password);
    await page.locator("#password-modal-confirm").click();
  }
  await expect(page.locator("#ctx-unlock-pill")).toHaveAttribute("data-state", "unlocked");

  await openTool(page, "sign-form");
  await page.locator("#sign-message").fill(message);
  await page.locator('#sign-form button[type="submit"]').click();
  await completePrivateOperation(page, password);
  const signed = await output(page, "sign-output");

  await openTool(page, "verify-form");
  await page.locator("#verify-payload").fill(signed);
  await page.locator("#verify-use-public-keys").check();
  await page.locator("#verify-public-keys").fill(JSON.stringify(JSON.parse(signed).identity));
  await page.locator('#verify-form button[type="submit"]').click();
  await expect(page.locator("#verify-result")).toContainText("Valid");

  await page.locator('.nav-item[data-page="contacts"]').click();
  await page.getByRole("button", { name: "Add contact", exact: true }).click();
  await page.locator("#contact-json").fill(JSON.stringify(JSON.parse(signed).identity));
  await page.locator("#contact-name").fill(contact);
  await page.locator('#import-form button[type="submit"]').click();
  await expect(page.locator("#contacts-list")).toContainText(contact);

  await openTool(page, "encrypt-form");
  await page.locator("#enc-message").fill(message);
  await pickContact(page, "enc-recipient", contact);
  await page.locator("#enc-sign").check();
  await page.locator('#encrypt-form button[type="submit"]').click();
  const encrypted = await output(page, "enc-output");

  await openTool(page, "decrypt-form");
  await page.locator("#dec-payload").fill(encrypted);
  await pickContact(page, "dec-sender", contact);
  await page.locator('#decrypt-form button[type="submit"]').click();
  await expect(page.locator("#dec-output")).toHaveValue(message);
  await expect(page.locator("#dec-verified")).toContainText("Valid");

  await openTool(page, "sign-file-form");
  await page.locator("#sign-file-input").setInputFiles(file);
  await page.locator('#sign-file-form button[type="submit"]').click();
  await completePrivateOperation(page, password);
  const fileSignature = await output(page, "sign-file-output");

  await openTool(page, "verify-file-form");
  await page.locator("#verify-file-input").setInputFiles(file);
  await page.locator("#verify-file-payload").fill(fileSignature);
  await page.locator('#verify-file-form button[type="submit"]').click();
  await expect(page.locator("#verify-file-result")).toContainText("Valid");

  await openTool(page, "encrypt-file-form");
  await page.locator("#enc-file-input").setInputFiles(file);
  await pickContact(page, "enc-file-recipient", contact);
  await page.locator("#enc-file-sign").check();
  await page.locator('#encrypt-file-form button[type="submit"]').click();
  const encryptedFile = await output(page, "enc-file-output");

  await openTool(page, "decrypt-file-form");
  await page.locator("#dec-file-payload").fill(encryptedFile);
  await pickContact(page, "dec-file-sender", contact);
  await page.locator('#decrypt-file-form button[type="submit"]').click();
  await expect(page.locator("#dec-file-info")).toHaveValue(new RegExp(file.name));
  await expect(page.locator("#dec-file-verified")).toContainText("Valid");
  const saved = page.waitForRequest((request) => request.url().endsWith("/api/v1/save-file"));
  await page.locator("#dec-file-download-btn").click();
  expect((await saved).postDataJSON()).toMatchObject({
    filename: file.name,
    base64Content: file.buffer.toString("base64"),
  });
});
