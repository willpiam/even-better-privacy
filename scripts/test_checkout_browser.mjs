import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const page = await browser.newPage();
  let order = {
    orderId: "123e4567-e89b-42d3-a456-426614174000", email: "alice@test.pqpost.com",
    fingerprint: "test-fingerprint", asset: "USDC", network: "ethereum-sepolia",
    recipient: `0x${"3".repeat(40)}`, assetUnit: `0x${"4".repeat(40)}`,
    usdCents: 400, amountAtomic: "4000000", decimals: 6, confirmations: 5, message: "pqpost:public-ref",
    expiresAt: Date.now() + 100_000, status: "quoted",
  };
  await page.route("http://127.0.0.1:8789/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/v1/mail/payment/")) {
      const body = path.endsWith("/transaction") ? { ...order, status: "confirmed" } : order;
      return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }
    const filename = `website/${path.slice(1) || "checkout.html"}`;
    if (!existsSync(filename)) return await route.fulfill({ status: 404 });
    const type = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript";
    await route.fulfill({ status: 200, contentType: type, body: readFileSync(filename) });
  });
  await page.goto(`http://127.0.0.1:8789/checkout.html#${order.orderId}`);
  await page.locator("#email").waitFor();
  if (await page.locator("#email").textContent() !== order.email) throw new Error("incorrect address");
  if (!await page.locator("#testnet").isVisible()) throw new Error("missing testnet notice");
  if (!(await page.locator("#instructions").textContent()).includes("0xa9059cbb")) throw new Error("missing token transfer calldata");
  await page.fill("#transaction", `0x${"1".repeat(64)}`);
  await page.click("#transaction-form button");
  await page.waitForFunction(() => document.querySelector("#status").textContent === "confirmed");
  order = { ...order, network: "cardano-preview", asset: "ADA", recipient: "addr_test1example", assetUnit: "lovelace", confirmations: 2, status: "quoted" };
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#network").textContent === "cardano-preview");
  if (!(await page.locator("#instructions").textContent()).includes("CIP-20")) throw new Error("missing Cardano metadata instructions");
  console.log("Local checkout uses test-domain orders on Sepolia and Cardano Preview.");
} finally {
  await browser.close();
}
