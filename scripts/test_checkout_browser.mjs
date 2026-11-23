import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
try {
  const context = await browser.newContext({ viewport: { width: 400, height: 850 } });
  const walletAddress = `0x${"1".repeat(40)}`;
  const hash = "a".repeat(64);
  const address = {
    orderId: "123e4567-e89b-42d3-a456-426614174000", email: "alice@test.pqpost.com",
    usdCents: 400, status: "quoted", message: "pqpost:public-ref",
  };
  const quotes = {
    "ethereum-sepolia": {
      ...address, asset: "USDC", network: "ethereum-sepolia",
      recipient: `0x${"3".repeat(40)}`, assetUnit: `0x${"4".repeat(40)}`,
      amountAtomic: "4000000", decimals: 6, confirmations: 5, message: "pqpost:public-ref",
      expiresAt: Date.now() + 100_000, canRestart: true,
    },
    "cardano-preview": {
      ...address, asset: "ADA", network: "cardano-preview",
      recipient: "addr_test1example", assetUnit: "lovelace", amountAtomic: "5000000",
      decimals: 6, confirmations: 3, message: "pqpost:public-ref", expiresAt: Date.now() + 100_000, canRestart: true,
    },
  };
  const reservation = {
    ...address, testnet: true,
    paymentAssets: Object.values(quotes).map(({ network, asset }) => ({ network, symbol: asset })),
  };
  let order = reservation;
  await context.addInitScript(({ walletAddress, hash }) => {
    window.walletSendRequests = 0;
    window.tokenBalance = "0x0";
    window.ethereum = {
      isMetaMask: true,
      async request({ method, params }) {
        switch (method) {
          case "wallet_switchEthereumChain": return;
          case "eth_chainId": return "0xaa36a7";
          case "eth_accounts":
          case "eth_requestAccounts": return [walletAddress];
          case "eth_getBalance": return "0x200000000000000";
          case "eth_call": return window.tokenBalance;
          case "eth_gasPrice": return "0x100000";
          case "eth_estimateGas": return "0x12000";
          case "eth_sendTransaction":
            window.walletSendRequests++;
            window.sentTransaction = params[0];
            return await new Promise(resolve => { window.approvePayment = () => resolve(`0x${hash}`); });
          default: throw new Error(`Unexpected wallet call ${method}`);
        }
      },
    };
    window.cardano = { lace: { name: "Lace", enable: async () => ({
      getNetworkId: async () => 0,
      getChangeAddress: async () => "addr_test1wallet",
      getUtxos: async () => ["wallet-utxo"],
      signTx: async unsigned => { window.cardanoUnsigned = unsigned; return "witness"; },
      submitTx: async signed => { window.cardanoSigned = signed; return hash; },
    }) } };
  }, { walletAddress, hash });

  await context.route(/^http:\/\/127\.0\.0\.1:8789\//, async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/v1/mail/payment/")) {
      const body = route.request().postDataJSON();
      switch (path.split("/").at(-1)) {
        case "restart":
          assert.equal(body.noPaymentSent, true);
          assert.equal(body.paymentReference, order.message);
          assert.equal(order.status, "quoted");
          order = reservation;
          break;
        case "select": {
          const quote = quotes[body.network];
          assert.equal(body.asset, quote.asset);
          if (body.preview) return await route.fulfill({ json: quote });
          order = quote;
          break;
        }
        case "cardano-tx":
          assert.equal(body.changeAddress, "addr_test1wallet");
          return await route.fulfill({ json: {
            ...(!body.preview && { unsignedTx: "unsigned-reviewed" }),
            feeLovelace: "180000", recipientLovelace: "5000000", recipientAmount: "5000000",
          } });
        case "cardano-assemble":
          assert.equal(body.unsignedTx, "unsigned-reviewed");
          assert.equal(body.witnessSet, "witness");
          return await route.fulfill({ json: { signedTx: "signed-reviewed" } });
        case "transaction":
          assert.equal(body.transactionId.replace(/^0x/, ""), hash);
          order = { ...order, status: "pending", confirmationsSeen: 0, transactionId: hash };
          break;
      }
      return await route.fulfill({ json: order });
    }
    const filename = `website/${path.slice(1)}`;
    if (!existsSync(filename)) return await route.fulfill({ status: 404 });
    const type = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css" : "text/javascript";
    await route.fulfill({ status: 200, contentType: type, body: readFileSync(filename) });
  });

  const checkoutUrl = `http://127.0.0.1:8789/checkout.html#${address.orderId}`;
  const button = (page, name) => page.getByRole("button", { name, exact: true });
  async function connect(page, network, wallet) {
    await page.goto(checkoutUrl);
    await page.reload();
    await page.getByLabel("Network", { exact: true }).waitFor();
    if (!await page.locator("#network").isDisabled()) await page.locator("#network").selectOption(network);
    await button(page, "Continue to wallet").click();
    await page.locator("#wallet").selectOption({ label: wallet });
    await button(page, "Connect wallet").click();
    await page.getByRole("heading", { name: "Choose a payment asset" }).waitFor();
  }

  const page = await context.newPage();
  await connect(page, "ethereum-sepolia", "MetaMask");
  await page.locator("#asset").selectOption("USDC");
  await page.getByText("Insufficient USDC.", { exact: false }).waitFor();
  assert(await button(page, "Review payment").isDisabled());
  assert.equal(order, reservation);
  await page.evaluate(() => { window.tokenBalance = "0x800000"; });
  await button(page, "Check funds again").click();
  await button(page, "Review payment").click();
  await page.locator("#review-step").waitFor();
  assert.equal(await page.locator("#amount").textContent(), "4 USDC");
  assert.equal(await page.locator("[aria-current=step]").textContent(), "Review");
  assert.equal(await page.locator("pre, #transaction-form").count(), 0);

  const other = await context.newPage();
  await connect(other, "ethereum-sepolia", "MetaMask");
  await other.evaluate(() => { window.tokenBalance = "0x800000"; });
  await other.locator("#back-wallet").click();
  await other.locator("#wallet").selectOption({ label: "MetaMask" });
  await button(other, "Connect wallet").click();
  await button(other, "Review payment").click();
  await button(page, "Submit Payment Transaction").click();
  await page.waitForFunction(() => window.walletSendRequests === 1);
  await button(other, "Submit Payment Transaction").click();
  await other.getByText("Payment is already open in another tab.").waitFor();
  assert.equal(await other.evaluate(() => window.walletSendRequests), 0);
  const tx = await page.evaluate(() => window.sentTransaction);
  assert.equal(tx.to, quotes["ethereum-sepolia"].assetUnit);
  assert.match(tx.data, /^0xa9059cbb/);
  await page.evaluate(() => window.approvePayment());
  await page.getByText("Waiting for the transaction to be included in a block…").waitFor();
  order = { ...order, confirmationsSeen: 2 };
  await page.getByText("2 of 5 block confirmations").waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("progress").getAttribute("value"), "2");
  order = { ...order, status: "confirmed" };
  await button(page, "Refresh status").click();
  await page.getByRole("heading", { name: "Payment confirmed" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "Payment confirmed" }).waitFor();

  order = { ...quotes["ethereum-sepolia"] };
  await page.reload();
  await button(page, "Change network or asset").click();
  await page.getByRole("heading", { name: "Change network or asset" }).waitFor();
  await button(page, "Start a new quote").click();
  assert.equal(order.network, "ethereum-sepolia");
  await page.getByRole("checkbox").check();
  await button(page, "Start a new quote").click();
  await page.getByRole("heading", { name: "Choose a network" }).waitFor();
  assert.equal(await page.locator("[aria-current=step]").textContent(), "Network");

  order = { ...quotes["ethereum-sepolia"], expiresAt: Date.now() - 1000 };
  await page.reload();
  await page.getByRole("heading", { name: "Your quote expired" }).waitFor();
  await page.getByRole("checkbox").check();
  await button(page, "Start a new quote").click();
  await page.getByRole("heading", { name: "Choose a network" }).waitFor();

  await connect(page, "cardano-preview", "Lace");
  await page.locator("#asset").selectOption("ADA");
  await button(page, "Review payment").click();
  await page.locator("#review-step").waitFor();
  assert.equal(await page.locator("#fee").textContent(), "0.18 ADA");
  await button(page, "Submit Payment Transaction").click();
  await page.getByText("Waiting for the transaction to be included in a block…").waitFor();
  assert.equal(await page.evaluate(() => window.cardanoUnsigned), "unsigned-reviewed");
  assert.equal(await page.evaluate(() => window.cardanoSigned), "signed-reviewed");
  assert.equal(await page.locator("#transaction-link").getAttribute("href"), `https://preview.cardanoscan.io/transaction/${hash}`);
  console.log("Checkout wizard passed for both networks, balance checks, review, confirmation, expired-quote recovery, and cross-tab protection.");
} finally {
  await browser.close();
}
