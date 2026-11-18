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
  await page.route(/^(http:\/\/127\.0\.0\.1:8789|https:\/\/(pqpost\.com|keys\.pqpost\.com))\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/v1/mail/payment/")) {
      if (path.endsWith("/transaction")) {
        const { transactionId } = route.request().postDataJSON();
        order = { ...order, status: "pending", transactionId: transactionId.toLowerCase().replace(/^0x/, "") };
      }
      return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(order) });
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

  const ethereumOrder = order;
  const cardanoOrder = { ...order, asset: "ADA", recipient: "addr_test1example", assetUnit: "lovelace", confirmations: 2 };
  const hash = "a".repeat(64);
  const link = page.locator("#transaction-link");
  for (const [network, quote, transactionId, explorerUrl] of [
    ["ethereum-sepolia", ethereumOrder, `0x${hash}`, `https://sepolia.etherscan.io/tx/0x${hash}`],
    ["cardano-preview", cardanoOrder, hash, `https://preview.cardanoscan.io/transaction/${hash}`],
    ["ethereum-mainnet", ethereumOrder, `0x${hash}`, `https://etherscan.io/tx/0x${hash}`],
    ["cardano-mainnet", cardanoOrder, hash, `https://cardanoscan.io/transaction/${hash}`],
  ]) {
    order = { ...quote, network, transactionId: null };
    const origin = network.endsWith("-mainnet") ? "https://pqpost.com" : "http://127.0.0.1:8789";
    await page.goto(`${origin}/checkout.html?network=${network}#${order.orderId}`);
    await page.locator("#email").waitFor();
    if (await link.isVisible()) throw new Error(`unexpected explorer link before submission on ${network}`);
    if (quote === cardanoOrder && !(await page.locator("#instructions").textContent()).includes("CIP-20")) {
      throw new Error("missing Cardano metadata instructions");
    }

    await page.fill("#transaction", transactionId);
    await page.click("#transaction-form button");
    await link.waitFor();
    if (await link.getAttribute("href") !== explorerUrl) throw new Error(`incorrect explorer URL on ${network}`);

    order = { ...order, status: "confirmed" };
    await page.click("#refresh");
    await page.waitForFunction(() => document.querySelector("#status").textContent === "confirmed");
    if (!await link.isVisible()) throw new Error(`missing explorer link after refresh on ${network}`);

    await page.reload();
    await link.waitFor();
    if (await link.getAttribute("href") !== explorerUrl) throw new Error(`incorrect explorer URL after reload on ${network}`);
  }
  console.log("Checkout links to submitted transactions on Ethereum and Cardano mainnets and testnets.");
} finally {
  await browser.close();
}
