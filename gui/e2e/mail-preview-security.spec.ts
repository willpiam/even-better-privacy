import { expect, test } from "@playwright/test";
import { buildSandboxedEmailSrcDoc } from "../../mobile/src/services/mail/sandboxedHtml";

test("mobile mail HTML renders while blocking redirects, remote resources, forms and popups", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const requests: string[] = [];
  await context.route("**/*", async (route) => {
    requests.push(route.request().url());
    await route.abort();
  });
  try {
    const page = await context.newPage();
    await page.setContent(buildSandboxedEmailSrcDoc(`
      <meta http-equiv="refresh" content="0;url=https://tracker.example.test/refresh">
      <base href="https://tracker.example.test/">
      <img src="https://tracker.example.test/image">
      <iframe src="https://tracker.example.test/frame"></iframe>
      <p id="message">Normal email content</p>
      <form action="https://tracker.example.test/form"><button>Submit</button></form>
      <a id="popup" target="_blank" href="https://tracker.example.test/popup">Open</a>
      <a id="link" href="https://tracker.example.test/link">Follow</a>
    `));
    const mail = page.frameLocator('iframe[title="Email content"]');
    await expect(mail.locator("#message")).toHaveText("Normal email content");
    await mail.getByRole("button", { name: "Submit" }).click();
    await mail.locator("#popup").click();
    expect(context.pages()).toHaveLength(1);
    await mail.locator("#link").click();
    await expect.poll(() => requests.length).toBe(0);
    expect(page.url()).toBe("about:blank");
  } finally {
    await context.close();
  }
});
