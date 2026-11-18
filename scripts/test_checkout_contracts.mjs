import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as walletHelpers from "../website/checkout-wallet.js";

const source = readFileSync(new URL("../website/checkout.js", import.meta.url), "utf8")
  .replace(/^import .*$/m, "");
const checkout = source.slice(0, source.indexOf('$("refresh").addEventListener'));
const order = {
  email: "alice@test.pqpost.com", status: "quoted", asset: "ETH",
  network: "ethereum-sepolia", assetUnit: "native",
  recipient: `0x${"1".repeat(40)}`, amountAtomic: "10", message: "order",
  expiresAt: Date.now() + 60_000,
};
const account = `0x${"2".repeat(40)}`;
const hash = `0x${"a".repeat(64)}`;

function element() {
  return {
    children: [],
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    addEventListener(_name, listener) { this.click = listener; },
    removeAttribute(name) { delete this[name]; },
  };
}

function walletLocks() {
  const held = new Set();
  return {
    async request(name, { ifAvailable }, callback) {
      assert.equal(ifAvailable, true);
      if (held.has(name)) return await callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

function page({ current = () => order, ethereum, cardano, submit, storage = new Map(), build, locks = walletLocks() }) {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const context = vm.createContext({
    ...walletHelpers, TextEncoder, URL, Date,
    location: { origin: "http://127.0.0.1:8789", hash: "#fixture", hostname: "127.0.0.1" },
    window: { ethereum, cardano },
    navigator: { locks },
    document: { getElementById, createElement: element, querySelectorAll: () => [] },
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    fetch: async (url, init) => {
      const path = url.split("/").at(-1);
      const body = JSON.parse(init.body);
      const response = path === "transaction" ? await submit(body.transactionId)
        : path === "cardano-tx" ? await build(body)
        : path === "cardano-assemble" ? { signedTx: "signed" }
        : current();
      return { ok: true, json: async () => response };
    },
  });
  const actions = vm.runInContext(checkout + "\n({payEthereum,payCardano,render});", context);
  return { ...actions, getElementById };
}
const settleClick = () => new Promise(setImmediate);
const { SEPOLIA_CHAIN_ID, walletPayKind, sepoliaPayment, cip30LovelaceAmount } = walletHelpers;

let sends = 0;
const wallet = { request: async ({ method }) => {
  if (method === "eth_requestAccounts") return [account];
  if (method === "eth_chainId") return SEPOLIA_CHAIN_ID;
  if (method === "eth_sendTransaction") {
    sends++;
    throw Object.assign(new Error("response lost after broadcast"), { code: -32603 });
  }
}};
await assert.rejects(page({ ethereum: wallet }).payEthereum(), /outcome is unknown/);
assert.equal(sends, 1);
sends = 0;
await assert.rejects(page({ current: () => ({ ...order, expiresAt: 1 }), ethereum: wallet }).payEthereum(), /expired/);
let refreshes = 0;
await assert.rejects(page({
  current: () => ++refreshes === 1 ? order : { ...order, expiresAt: 1 }, ethereum: wallet,
}).payEthereum(), /cannot be paid/);
assert.equal(sends, 0);
assert.equal(walletPayKind({ ...order, expiresAt: 1 }), null);
assert.equal(sepoliaPayment(order, account).chainId, SEPOLIA_CHAIN_ID);
assert.equal(cip30LovelaceAmount(3_000_000n), "1a002dc6c0");

let switches = 0;
const wrongChain = { request: async ({ method }) => {
  if (method === "wallet_switchEthereumChain" && ++switches === 1) {
    throw Object.assign(new Error("unknown chain"), { code: 4902 });
  }
  if (method === "eth_requestAccounts") return [account];
  if (method === "eth_chainId") return "0x1";
  if (method === "eth_sendTransaction") sends++;
}};
await assert.rejects(page({ ethereum: wrongChain }).payEthereum(), /Switch.*Sepolia/);
assert.equal(switches, 2);
assert.equal(sends, 0);

const storage = new Map();
const submissions = [];
const retryOptions = {
  storage,
  ethereum: { request: async ({ method }) => {
    if (method === "eth_requestAccounts") return [account];
    if (method === "eth_chainId") return SEPOLIA_CHAIN_ID;
    if (method === "eth_sendTransaction") { sends++; return hash; }
  }},
  submit: async id => {
    submissions.push(id);
    if (submissions.length < 3) throw new Error("offline");
    return { ...order, status: "pending", transactionId: id };
  },
};
let checkoutPage = page(retryOptions);
checkoutPage.render(order);
let button = checkoutPage.getElementById("wallet-pay").children.at(-1);
button.click();
await settleClick();
button = checkoutPage.getElementById("wallet-pay").children.at(-1);
assert.equal(button.textContent, "Submit saved transaction");
button.click();
await settleClick();
checkoutPage = page(retryOptions);
checkoutPage.render(order);
button = checkoutPage.getElementById("wallet-pay").children.at(-1);
assert.equal(button.textContent, "Submit saved transaction");
button.click();
await settleClick();
assert.equal(sends, 1);
assert.deepEqual(submissions, [hash, hash, hash]);
assert.equal(storage.size, 0);

const approved = Promise.withResolvers();
let approvalRequests = 0;
const sharedWallet = {
  request: async ({ method }) => {
    if (method === "eth_requestAccounts") return [account];
    if (method === "eth_chainId") return SEPOLIA_CHAIN_ID;
    if (method === "eth_sendTransaction") {
      approvalRequests++;
      return await approved.promise;
    }
  },
};
const shared = { storage: new Map(), locks: walletLocks(), ethereum: sharedWallet, submit: async () => { throw new Error("offline"); } };
const firstTab = page(shared), secondTab = page(shared);
for (const tab of [firstTab, secondTab]) {
  tab.render(order);
  tab.getElementById("wallet-pay").children.at(-1).click();
  await settleClick();
}
assert.equal(approvalRequests, 1);
assert.match(secondTab.getElementById("error").textContent, /already open in another tab/);
approved.resolve(hash);
await settleClick();
secondTab.getElementById("wallet-pay").children.at(-1).click();
await settleClick();
assert.equal(approvalRequests, 1);
assert.equal(secondTab.getElementById("transaction").value, hash);

const tokenOrder = {
  ...order, asset: "tUSDM", network: "cardano-preview",
  assetUnit: "ab".repeat(28) + "636f696e",
};
const fundingRequests = [];
const cardano = { preview: { enable: async () => ({
  getNetworkId: async () => 0,
  getChangeAddress: async () => "address",
  getUtxos: async amount => {
    fundingRequests.push(amount);
    return fundingRequests.length === 1 ? null : ["input covering the token and ADA"];
  },
  getBalance: async () => `821a002625a0a1581c${"ab".repeat(28)}a144636f696e0a`,
  signTx: async () => "witness",
  submitTx: async () => "b".repeat(64),
}) }};
await page({
  cardano, current: () => tokenOrder,
  build: async ({ utxos }) => {
    assert.deepEqual(utxos, ["input covering the token and ADA"]);
    return { unsignedTx: "unsigned" };
  },
  submit: async () => ({ ...tokenOrder, status: "pending" }),
}).payCardano("preview");
assert.deepEqual(fundingRequests, [
  `821a002dc6c0a1581c${"ab".repeat(28)}a144636f696e0a`,
  `821a002625a0a1581c${"ab".repeat(28)}a144636f696e0a`,
]);

console.log("Checkout contracts passed for quote expiry, Sepolia selection, cross-tab payment, saved-hash recovery and Cardano funding.");
