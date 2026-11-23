import { CARDANO_FUNDING_BUFFER, SEPOLIA_CHAIN_ID, cip30PaymentAmount, cip30WalletLovelace, sepoliaPayment, tokenPaymentData, walletPayKind } from "./checkout-wallet.js";

// The API origins are intentionally fixed: a link cannot redirect an order to an attacker.
const localTest = location.origin === "http://127.0.0.1:8789";
const apiOrigin = localTest ? location.origin
  : location.hostname === "pqpost.com" || location.hostname === "test.pqpost.com"
    ? "https://keys.pqpost.com"
    : "";
let id = "";
try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* invalid link */ }
const $ = (id) => document.getElementById(id);
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const transactionExplorers = new Map([
  ["ethereum-mainnet", { name: "Etherscan", url: "https://etherscan.io/tx/0x" }],
  ["ethereum-sepolia", { name: "Sepolia Etherscan", url: "https://sepolia.etherscan.io/tx/0x" }],
  ["cardano-mainnet", { name: "Cardanoscan", url: "https://cardanoscan.io/transaction/" }],
  ["cardano-preview", { name: "Cardanoscan Preview", url: "https://preview.cardanoscan.io/transaction/" }],
]);
let busy = false;
function normalizeHash(hash) {
  return typeof hash === "string" ? hash.toLowerCase().replace(/^0x/, "") : "";
}
const hashStorageKey = `pqpost:checkout:transaction:${id}`;
function readSavedHash() {
  try {
    const stored = localStorage.getItem(hashStorageKey);
    if (typeof stored === "string" && /^(?:0x)?[0-9a-f]{64}$/i.test(stored)) return stored;
  } catch { /* Storage may be unavailable. Keep the hash in memory in that case. */ }
  return "";
}
let savedHash = readSavedHash();

function saveHash(hash) {
  savedHash = hash;
  try {
    if (hash) localStorage.setItem(hashStorageKey, hash);
    else localStorage.removeItem(hashStorageKey);
  } catch { /* The in-memory copy still supports retries on this page. */ }
}

function showError(message) { $("error").textContent = message; $("error").hidden = !message; }
function decimalAmount(raw, decimals) {
  const value = String(raw).padStart(decimals + 1, "0");
  if (!decimals) return value;
  const whole = value.slice(0, -decimals);
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
function addInstruction(text, code) {
  const p = document.createElement("p"); p.textContent = text; $("instructions").append(p);
  if (code) { const pre = document.createElement("pre"); pre.textContent = code; $("instructions").append(pre); }
}
function renderTransactionLink(order) {
  const explorer = transactionExplorers.get(order.network);
  const hash = typeof order.transactionId === "string" ? order.transactionId.replace(/^0x/i, "") : "";
  const link = $("transaction-link");
  if (explorer && /^[0-9a-f]{64}$/i.test(hash)) {
    link.href = explorer.url + hash;
    link.textContent = `View transaction on ${explorer.name}`;
    $("transaction-explorer").hidden = false;
  } else {
    $("transaction-explorer").hidden = true;
    link.removeAttribute("href");
    link.textContent = "";
  }
}
function renderPaymentMethods(assets) {
  const select = $("payment-method");
  const selected = select.value;
  select.replaceChildren(new Option("Choose an asset", ""));
  for (const { network, symbol } of assets) {
    select.add(new Option(`${symbol} · ${network}`, JSON.stringify({ network, asset: symbol })));
  }
  select.value = Array.from(select.options).some(option => option.value === selected) ? selected : "";
  $("payment-method-form").hidden = !assets.length;
}
function render(order) {
  const awaitingAsset = Array.isArray(order.paymentAssets);
  const test = order.testnet === true || order.network === "ethereum-sepolia" || order.network === "cardano-preview";
  if ((localTest || location.hostname === "test.pqpost.com") !== test) throw new Error("The order is for a different network environment.");
  for (const key of ["email", "fingerprint", "network", "recipient", "message", "status"]) $(key).textContent = order[key] ?? "";
  $("price").textContent = `$${(order.usdCents / 100).toFixed(2)} USD`;
  if (!awaitingAsset) {
    $("confirmations").textContent = String(order.confirmations);
    $("amount").textContent = `${decimalAmount(order.amountAtomic, order.decimals)} ${order.asset}`;
    $("expiry").textContent = new Date(order.expiresAt).toLocaleString();
  }
  $("instructions").replaceChildren();
  document.querySelectorAll("[data-quote]").forEach(element => {
    element.hidden = awaitingAsset || order.status === "cancelled";
  });
  renderPaymentMethods(order.paymentAssets ?? []);
  $("testnet").hidden = !test;
  if (order.status === "cancelled") {
    addInstruction("This purchase was cancelled. The address is no longer reserved. If you already sent payment, contact support with your transaction ID.");
  } else if (awaitingAsset && order.status === "expired") {
    addInstruction("This reservation expired. Return to the app to check the address again.");
  } else if (order.status === "pending") {
    addInstruction("If your wallet replaced the transaction, submit the new transaction ID below.");
  } else if (order.status === "quoted") {
    if (awaitingAsset) {
      $("status").textContent = "Awaiting payment selection";
      if (!order.paymentAssets.length) addInstruction("Payment assets are unavailable. Refresh status to retry.");
    } else {
      renderQuoteInstructions(order);
    }
  }
  const canSubmit = !awaitingAsset && (order.status === "quoted" || order.status === "pending");
  $("transaction-form").hidden = !canSubmit;
  $("transaction-submit").textContent = order.status === "pending" ? "Submit replacement transaction" : "Submit transaction";
  if (savedHash && (normalizeHash(savedHash) === normalizeHash(order.transactionId) ||
    order.status === "confirmed" || order.status === "fulfilled")) saveHash("");
  renderTransactionLink(order);
  if (awaitingAsset) $("wallet-pay").hidden = true;
  else renderWallet(order);
  $("loading").hidden = true; $("order").hidden = false;
}
function renderQuoteInstructions(order) {
  if (savedHash) return;
  if (order.expiresAt <= Date.now()) {
    addInstruction("The quote expired. If you already paid, submit its transaction ID below.");
  } else if (order.network.startsWith("cardano-")) {
    addInstruction("Send the exact amount with the payment message as the only entry in the CIP-20 msg array under metadata label 674. Token outputs also require the minimum ADA.");
    if (order.assetUnit !== "lovelace") addInstruction("Cardano asset identifier:", order.assetUnit);
  } else if (order.assetUnit === "native") {
    const messageHex = Array.from(new TextEncoder().encode(order.message), b => b.toString(16).padStart(2, "0")).join("");
    addInstruction("Send the ETH amount using a wallet that supports custom transaction input data. Set input data to:", `0x${messageHex}`);
  } else {
    addInstruction(`Send a zero-ETH transaction to the ${order.asset} token contract using a wallet that supports custom input data. Confirm the wallet shows the expected token transfer before signing.`, order.assetUnit);
    addInstruction("Transaction input data:", tokenPaymentData(order));
  }
}
async function runWalletCheckout(pay) {
  if (savedHash) return submitTransaction(savedHash);
  return navigator.locks.request(hashStorageKey, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Payment is already open in another tab.");
    savedHash = readSavedHash();
    return savedHash ? submitTransaction(savedHash) : pay();
  });
}

function walletButton(order, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = title;
  button.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    showError("");
    runWalletCheckout(onClick).then(render).catch((error) => {
      showError(error instanceof Error ? error.message : String(error));
      if (savedHash) render(order);
    }).finally(() => {
      busy = false;
    });
  });
  return button;
}
function renderWallet(order) {
  const box = $("wallet-pay");
  box.replaceChildren();
  if (savedHash) {
    $("transaction").value = savedHash;
    box.hidden = false;
    if (order.status === "quoted" || order.status === "pending") {
      box.append(walletButton(order, "Submit saved transaction", () => submitTransaction(savedHash)));
    } else {
      const note = document.createElement("p");
      note.textContent = `Give support this transaction ID: ${savedHash}`;
      box.append(note);
    }
    return;
  }
  const kind = walletPayKind(order);
  if (!kind) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const note = document.createElement("p");
  note.className = "muted";
  if (!globalThis.navigator?.locks) {
    note.textContent = "Open checkout in a browser that supports wallet payments across tabs, or submit a transaction ID below.";
    box.append(note);
    return;
  }
  note.textContent = kind === "ethereum"
    ? "Pay from an Ethereum wallet on Sepolia. Test funds only."
    : "Pay from a Cardano wallet on the preview network. Test funds only. A preprod wallet cannot be detected here.";
  box.append(note);
  if (kind === "ethereum") {
    box.append(walletButton(order, "Pay with Ethereum wallet", () => payEthereum()));
    return;
  }
  const wallets = cardanoWalletNames();
  if (!wallets.length) {
    note.textContent = "Open this page in a browser with a Cardano preview wallet, or paste a transaction id below.";
    return;
  }
  for (const name of wallets) {
    box.append(walletButton(order, `Pay with ${name}`, () => payCardano(name)));
  }
}
function cardanoWalletNames() {
  const injected = window.cardano;
  if (!injected || typeof injected !== "object") return [];
  return Object.keys(injected).filter((name) =>
    injected[name] && typeof injected[name].enable === "function"
  );
}
async function switchSepolia(ethereum) {
  const switchChain = {
    method: "wallet_switchEthereumChain",
    params: [{ chainId: SEPOLIA_CHAIN_ID }],
  };
  try {
    await ethereum.request(switchChain);
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: SEPOLIA_CHAIN_ID,
        chainName: "Sepolia",
        nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
      }],
    });
    await ethereum.request(switchChain);
  }
}
async function payEthereum() {
  const ethereum = window.ethereum;
  if (!ethereum?.request) throw new Error("No Ethereum wallet is available in this browser.");
  let order = await request("status");
  if (walletPayKind(order) !== "ethereum") throw new Error("This quote has expired or is no longer payable. Refresh checkout.");
  await switchSepolia(ethereum);
  const accounts = await ethereum.request({ method: "eth_requestAccounts" });
  order = await request("status");
  const tx = sepoliaPayment(order, accounts[0]);
  if (await ethereum.request({ method: "eth_chainId" }) !== SEPOLIA_CHAIN_ID) {
    throw new Error("Switch your Ethereum wallet to Sepolia before paying.");
  }
  let hash;
  try {
    hash = await ethereum.request({ method: "eth_sendTransaction", params: [tx] });
  } catch (error) {
    if (error?.code === 4001) throw error;
    throw new Error("The wallet send outcome is unknown. Check your wallet transaction history before sending again.");
  }
  if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
    throw new Error("The wallet did not return a transaction id.");
  }
  return await submitWalletTransaction(hash);
}
async function payCardano(name) {
  const order = await request("status");
  if (walletPayKind(order) !== "cardano") throw new Error("This quote has expired or is no longer payable.");
  const api = await window.cardano[name].enable();
  if (await api.getNetworkId() !== 0) {
    throw new Error("Switch the Cardano wallet to the preview network. This page cannot tell preview from preprod.");
  }
  const changeAddress = await api.getChangeAddress();
  let utxos = await api.getUtxos(cip30PaymentAmount(order));
  if (!utxos?.length) {
    const balance = cip30WalletLovelace(await api.getBalance());
    const paymentAda = order.assetUnit === "lovelace" ? BigInt(order.amountAtomic) : 0n;
    const available = balance - paymentAda;
    // Let the builder calculate the fee from the selected inputs and current protocol parameters.
    if (available > 0n && available < CARDANO_FUNDING_BUFFER) {
      utxos = await api.getUtxos(cip30PaymentAmount(order, available));
    }
  }
  if (!utxos?.length) throw new Error("The Cardano wallet has insufficient funds for this payment.");
  const built = await request("cardano-tx", { changeAddress, utxos });
  if (walletPayKind(await request("status")) !== "cardano") throw new Error("This quote expired before signing.");
  const witnessSet = await api.signTx(built.unsignedTx, false);
  const assembled = await request("cardano-assemble", {
    unsignedTx: built.unsignedTx,
    witnessSet,
  });
  const txHash = await api.submitTx(assembled.signedTx);
  if (typeof txHash !== "string" || !/^[0-9a-f]{64}$/i.test(txHash)) {
    throw new Error("The wallet did not return a transaction id.");
  }
  return await submitWalletTransaction(txHash);
}
async function submitWalletTransaction(hash) {
  saveHash(hash);
  $("transaction").value = hash;
  return await submitTransaction(hash);
}
async function submitTransaction(transactionId) {
  const order = await request("transaction", { transactionId });
  if (savedHash && normalizeHash(savedHash) === normalizeHash(transactionId)) saveHash("");
  return order;
}
async function request(path, extra = {}) {
  const response = await fetch(`${apiOrigin}/api/v1/mail/payment/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: id, ...extra }), cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to reach the payment server.");
  return body;
}
async function refresh() {
  if (busy) return;
  busy = true; showError("");
  try { render(await request("status")); } catch (error) { showError(error.message); $("loading").hidden = true; } finally { busy = false; }
}
$("refresh").addEventListener("click", refresh);
$("payment-method-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const selected = $("payment-method").value;
  if (busy || !selected) return;
  busy = true;
  showError("");
  try {
    await request("select", JSON.parse(selected));
    render(await request("status"));
  } catch (error) {
    showError(error.message);
  } finally {
    busy = false;
  }
});
$("transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return; busy = true; showError("");
  try { render(await submitTransaction($("transaction").value.trim())); }
  catch (error) { showError(`${error.message} Refresh status before retrying.`); }
  finally { busy = false; }
});
if (!apiOrigin || !validId.test(id)) { $("loading").hidden = true; showError("Open the checkout link from your pqpost app."); }
else void refresh();
