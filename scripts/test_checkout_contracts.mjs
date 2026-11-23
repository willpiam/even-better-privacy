import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as walletHelpers from "../website/checkout-wallet.js";

const source = readFileSync(new URL("../website/checkout.js", import.meta.url), "utf8")
  .replace(/^import .*$/m, "").split("if (!apiOrigin || !validId.test(id))")[0];
const id = "123e4567-e89b-42d3-a456-426614174000";
const account = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;
const order = {
  orderId: id, email: "alice@test.pqpost.com", status: "quoted", asset: "ETH", usdCents: 200,
  network: "ethereum-sepolia", assetUnit: "native", recipient: `0x${"1".repeat(40)}`,
  amountAtomic: "10", decimals: 18, message: "order", expiresAt: Date.now() + 60_000, confirmations: 3,
};

function element() {
  return {
    children: [], value: "", hidden: true, classList: { toggle() {} },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {},
    querySelector() { return this; },
    add(option) { this.children.push(option); },
    get options() { return this.children; },
    replaceChildren(...children) { this.children = children; },
  };
}

function page({ origin = "https://test.pqpost.com", current = () => order, wallet, submit, storage = new Map() } = {}) {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({
    ...walletHelpers, TextEncoder, URL, Date, Event, clearTimeout, setTimeout: () => 0,
    Option: class { constructor(label, value) { Object.assign(this, { label, value }); } },
    location: { origin, hash: `#${id}`, hostname: new URL(origin).hostname },
    window: { addEventListener() {}, dispatchEvent() {} },
    navigator: { locks: { request: (_key, _options, fn) => fn({}) } },
    document: { getElementById: $, querySelectorAll: () => Array.from({ length: 5 }, element) },
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    wallet, initialOrder: order, account,
    fetch: async (url, init) => {
      const path = url.split("/").at(-1);
      const result = path === "transaction" ? await submit(JSON.parse(init.body).transactionId) : current();
      return { ok: true, json: async () => result };
    },
  });
  const actions = vm.runInContext(source + `
    order = initialOrder;
    network = order.network;
    connected = { provider: wallet, account, name: "MetaMask" };
    prepared = { quote: order, tx: sepoliaPayment(order, account) };
    ({ render, sendPayment, switchSepolia });
  `, context);
  return { ...actions, $ };
}

const reservation = {
  email: order.email, status: "quoted", usdCents: 200, testnet: true,
  paymentAssets: [{ network: "ethereum-sepolia", symbol: "ETH" }],
};
const selection = page();
selection.render(reservation);
assert.equal(selection.$("network-step").hidden, false);
assert.equal(selection.$("review-step").hidden, true);
assert.equal(selection.$("price").textContent, "$2.00 USD");
assert.throws(() => page({ origin: "https://pqpost.com" }).render(reservation), /different network environment/);
selection.render({ ...order, status: "pending", confirmationsSeen: 2 });
assert.equal(selection.$("status").textContent, "2 of 3 block confirmations");
selection.render({ ...order, status: "confirmed" });
assert.equal(selection.$("confirmation-title").textContent, "Payment confirmed");

const methods = {
  eth_accounts: [account], eth_chainId: walletHelpers.SEPOLIA_CHAIN_ID,
  eth_getBalance: "0x10000000", eth_gasPrice: "0x01", eth_estimateGas: "0x6000",
};
let sends = 0;
const wallet = { request: async ({ method }) => {
  if (method === "eth_sendTransaction") {
    sends++;
    return hash;
  }
  assert(Object.hasOwn(methods, method), method);
  return methods[method];
} };
await page({ current: () => ({ ...order, expiresAt: 1 }), wallet }).sendPayment();
assert.equal(sends, 0);
await assert.rejects(page({ current: () => ({ ...order, amountAtomic: "11" }), wallet }).sendPayment(), /quote changed/);
assert.equal(sends, 0);
const storage = new Map();
const submissions = [];
const submit = async txHash => {
  submissions.push(txHash);
  if (submissions.length === 1) throw new Error("Network offline");
  return { ...order, status: "pending", transactionId: txHash };
};
await assert.rejects(page({ wallet, storage, submit }).sendPayment(), /Network offline/);
assert.equal(storage.size, 1);
await page({ wallet, storage, submit }).sendPayment();
assert.equal(sends, 1);
assert.deepEqual(submissions, [hash, hash]);
assert.equal(storage.size, 0);
const uncertainStorage = new Map();
const uncertainWallet = { request: async args => {
  if (args.method === "eth_sendTransaction") throw new Error("Wallet response lost");
  return wallet.request(args);
} };
await assert.rejects(page({ wallet: uncertainWallet, storage: uncertainStorage }).sendPayment(), /response lost/);
const recovered = page({ wallet, storage: uncertainStorage });
await recovered.sendPayment();
assert.match(recovered.$("status").textContent, /Check your wallet history/);
assert.equal(sends, 1);

console.log("Checkout contracts passed for environment checks, confirmation counts, stale quotes, and payment recovery.");
