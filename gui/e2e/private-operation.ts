import { expect, type Page } from "@playwright/test";

/** Handle explicit signing approval and the existing shared unlock session. */
export async function completePrivateOperation(page: Page, password: string) {
  for (let step = 0; step < 4; step++) {
    let next = "pending";
    await expect.poll(async () => {
      if (await page.locator("#password-modal").isVisible()) return next = "password";
      if (await page.locator("#confirm-modal").isVisible()
        && await page.locator("#confirm-modal-title").textContent() === "Confirm Signing Request") {
        return next = "sign";
      }
      if (await page.locator(".page.active button.loading").count() === 0) return next = "done";
      return next = "pending";
    }, { timeout: 30_000 }).not.toBe("pending");
    if (next === "done") return;
    if (next === "sign") {
      await page.locator("#confirm-modal-confirm").click();
    } else {
      await page.locator("#password-modal-input").fill(password);
      await page.locator("#password-modal-confirm").click();
      await expect(page.locator("#password-modal")).toBeHidden();
    }
  }
  throw new Error("Private operation did not finish after approval and unlock");
}
