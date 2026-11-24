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
      ...address, asset: "USDC", network: "ethereum-sepolia", usdPerToken: "1",
      recipient: `0x${"3".repeat(40)}`, assetUnit: `0x${"4".repeat(40)}`,
      amountAtomic: "4000000", decimals: 6, confirmations: 5, message: "pqpost:public-ref",
      expiresAt: Date.now() + 100_000, canRestart: false,
    },
    "cardano-preview": {
      ...address, asset: "tUSDCx", network: "cardano-preview",
      recipient: "addr_test1example", assetUnit: "ab".repeat(28) + "745553444378", amountAtomic: "2000000",
      decimals: 6, confirmations: 3, message: "pqpost:public-ref", expiresAt: Date.now() + 100_000, canRestart: false,
    },
  };
  const reservation = {
    ...address, testnet: true,
    paymentAssets: Object.values(quotes).map(({ network, asset }) => ({ network, symbol: asset })),
  };
  let order = reservation;
  let paymentVisible = true;
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
    window.cardanoFunded = false;
    window.cardanoHasAddress = false;
    window.cardanoAddressReads = 0;
    window.cardano = { lace: { name: "lace", enable: async () => ({
      getNetworkId: async () => 0,
      getChangeAddress: async () => {
        window.cardanoAddressReads++;
        if (!window.cardanoHasAddress) throw { code: -2, info: "No addresses available" };
        return "addr_test1wallet";
      },
      getBalance: async () => "00",
      getUtxos: async () => window.cardanoFunded ? ["wallet-utxo"] : null,
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
          assert.equal(body.paymentReference, order.message);
          assert.equal(order.status, "expired");
          assert.equal(order.network, undefined);
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
            feeLovelace: "180000", recipientLovelace: "1043020", recipientAmount: "2000000",
          } });
        case "cardano-assemble":
          assert.equal(body.unsignedTx, "unsigned-reviewed");
          assert.equal(body.witnessSet, "witness");
          return await route.fulfill({ json: { signedTx: "signed-reviewed" } });
        case "transaction":
          assert.equal(body.transactionId.replace(/^0x/, ""), hash);
          if (!paymentVisible) {
            return await route.fulfill({ status: 409, json: { error: "Payment is not visible on-chain yet.", retryPayment: true } });
          }
          order = { ...order, status: order.status === "cancelled" ? "manual_review" : "pending",
            confirmationsSeen: 1, transactionId: hash };
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
  assert.equal(await button(page, "About minimum UTxO").isVisible(), false);
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
  await page.getByText("1 of 5 block confirmations").waitFor();
  order = { ...order, confirmationsSeen: 2 };
  await page.getByText("2 of 5 block confirmations").waitFor({ timeout: 20_000 });
  assert.equal(await page.locator("progress").getAttribute("value"), "2");
  assert.equal(await page.locator("#receipt").isVisible(), false);
  order = { ...order, status: "confirmed" };
  await button(page, "Refresh status").click();
  await page.getByRole("heading", { name: "Payment confirmed" }).waitFor();
  const receipt = page.locator("#receipt");
  await receipt.getByRole("heading", { name: "Test payment confirmation" }).waitFor();
  await receipt.getByText("Starling Kestrel Laboratories Inc.", { exact: true }).waitFor();
  await receipt.getByText("alice@test.pqpost.com (5-character username)", { exact: true }).waitFor();
  await receipt.getByText("1 USD per USDC", { exact: true }).waitFor();
  await receipt.getByText("On-chain crypto payment (USDC)", { exact: true }).waitFor();
  await page.emulateMedia({ media: "print" });
  const explorerUrl = `https://sepolia.etherscan.io/tx/0x${hash}`;
  const receiptLink = receipt.getByRole("link", { name: explorerUrl });
  await receiptLink.waitFor();
  assert.equal(await receiptLink.getAttribute("href"), explorerUrl);
  const qr = receipt.getByRole("img", { name: /QR code/ });
  await qr.waitFor();
  assert.equal(await qr.evaluate(canvas => canvas.getContext("2d").getImageData(16, 16, 1, 1).data[0]), 0);
  await page.emulateMedia({ media: "screen" });
  await page.reload();
  await page.getByRole("heading", { name: "Payment confirmed" }).waitFor();

  order = { ...quotes["ethereum-sepolia"], status: "cancelled" };
  paymentVisible = false;
  await page.reload();
  await page.getByLabel("Transaction ID").fill(hash);
  await button(page, "Report payment").click();
  await page.getByText("Payment is not visible on-chain yet.").waitFor();
  paymentVisible = true;
  await page.reload();
  await page.getByText("This payment needs review.", { exact: false }).waitFor();

  order = { ...reservation, status: "expired", canRestart: true };
  await page.reload();
  await page.getByRole("heading", { name: "Your reservation expired" }).waitFor();
  await button(page, "Start a new quote").click();
  await page.getByRole("heading", { name: "Choose a network" }).waitFor();

  await connect(page, "cardano-preview", "Lace");
  assert.equal(await page.evaluate(() => window.cardanoAddressReads), 0);
  await page.locator("#asset").selectOption("tUSDCx");
  await page.getByText("This wallet has no test ADA available.", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.cardanoAddressReads), 0);
  assert(await button(page, "Review payment").isDisabled());
  await page.evaluate(() => { window.cardanoFunded = true; });
  await button(page, "Check funds again").click();
  await page.getByText("Lace has no payment address available.", { exact: false }).waitFor();
  assert(await button(page, "Review payment").isDisabled());
  await page.evaluate(() => { window.cardanoHasAddress = true; });
  await button(page, "Check funds again").click();
  await button(page, "Review payment").click();
  await page.locator("#review-step").waitFor();
  assert.equal(await page.locator("#fee").textContent(), "0.18 ADA");
  assert.equal(await page.locator("#extra-amount").textContent(), "1.04302 ADA");
  const minUtxo = button(page, "About minimum UTxO");
  assert.equal(await page.locator("#min-utxo-note").isVisible(), false);
  await minUtxo.click();
  await page.getByText("Cardano requires each token output to carry", { exact: false }).waitFor();
  assert.equal(await minUtxo.getAttribute("aria-expanded"), "true");
  await minUtxo.press("Enter");
  assert.equal(await page.locator("#min-utxo-note").isVisible(), false);
  await button(page, "Submit Payment Transaction").click();
  await page.getByText("1 of 3 block confirmations").waitFor();
  assert.equal(await page.evaluate(() => window.cardanoUnsigned), "unsigned-reviewed");
  assert.equal(await page.evaluate(() => window.cardanoSigned), "signed-reviewed");
  assert.equal(await page.locator("#transaction-link").getAttribute("href"), `https://preview.cardanoscan.io/transaction/${hash}`);
  console.log("Checkout wizard passed for both networks, balance checks, review, confirmation, expired-quote recovery, and cross-tab protection.");
} finally {
  await browser.close();
}
