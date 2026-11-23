import { CARDANO_FUNDING_BUFFER, SEPOLIA_CHAIN_ID, cip30PaymentAmount, cip30WalletLovelace, sepoliaPayment, walletPayKind } from "./checkout-wallet.js";

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
const savedReferenceKey = `${hashStorageKey}:reference`;
let savedReference = readSavedReference(savedHash);

function readSavedReference(hash) {
  if (!hash) return;
  try {
    const record = JSON.parse(localStorage.getItem(savedReferenceKey));
    if (record?.hash === hash && typeof record.reference === "string") return record.reference;
  } catch { /* Legacy saved hashes have no reference. */ }
}

function restoreSavedPayment() {
  const hash = readSavedHash();
  if (hash) {
    savedReference = readSavedReference(hash) ?? (hash === savedHash ? savedReference : undefined);
    savedHash = hash;
  }
}

function saveHash(hash, reference) {
  savedHash = hash;
  savedReference = reference;
  try {
    if (hash) {
      localStorage.setItem(hashStorageKey, hash);
      if (reference) localStorage.setItem(savedReferenceKey, JSON.stringify({ hash, reference }));
    } else {
      localStorage.removeItem(hashStorageKey);
      localStorage.removeItem(savedReferenceKey);
    }
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
async function request(path, extra = {}) {
  const response = await fetch(`${apiOrigin}/api/v1/mail/payment/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: id, ...extra }), cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to reach the payment server.");
  return body;
}

const networks = new Map([
  ["ethereum-sepolia", "Ethereum Sepolia"],
  ["cardano-preview", "Cardano Preview"],
]);
const steps = ["network", "wallet", "asset", "review", "confirmation"];
const ethereumWallets = new Map();
const uncertainKey = `${hashStorageKey}:uncertain`;
let uncertain = readUncertain();
let order;
let network = "";
let connected;
let funded;
let prepared;
let activeStep;
let restartReturnStep;
let busy = false;
let poll;

function readUncertain() {
  try { return localStorage.getItem(uncertainKey) === "1"; } catch { return false; }
}

function markUncertain(value) {
  uncertain = value;
  try {
    if (value) localStorage.setItem(uncertainKey, "1");
    else localStorage.removeItem(uncertainKey);
  } catch { /* Keep the state in memory when storage is unavailable. */ }
}

function setStep(step) {
  const indicators = document.querySelectorAll(".steps li");
  const current = step === "restart" ? steps.indexOf("network") : steps.indexOf(step);
  $("restart-step").hidden = step !== "restart";
  $("steps").hidden = false;
  for (const [index, name] of steps.entries()) {
    $(`${name}-step`).hidden = name !== step;
    const indicator = indicators[index];
    indicator.classList.toggle("done", index < current ||
      (step === "confirmation" && ["confirmed", "fulfilled"].includes(order?.status)));
    if (index === current) indicator.setAttribute("aria-current", "step");
    else indicator.removeAttribute("aria-current");
  }
  if (activeStep !== step) $(`${step}-step`).querySelector("h2").focus();
  activeStep = step;
  $("change-payment").hidden = step === "restart" || step === "confirmation" ||
    !order?.network || order.canRestart !== true;
}

function selectOptions(select, placeholder, options, selected = select.value) {
  select.replaceChildren(new Option(placeholder, ""));
  for (const [value, label] of options) select.add(new Option(label, value));
  select.value = Array.from(select.options).some(option => option.value === selected) ? selected : "";
}

function walletOptions() {
  if (network === "ethereum-sepolia") {
    const wallets = new Map(ethereumWallets);
    const provider = window.ethereum;
    if (provider?.request && !Array.from(wallets.values()).some(wallet => wallet.provider === provider)) {
      wallets.set("injected", { name: provider.isMetaMask ? "MetaMask" : "Browser Ethereum wallet", provider });
    }
    return wallets;
  }
  return new Map(Object.entries(window.cardano ?? {})
    .filter(([, provider]) => typeof provider?.enable === "function")
    .map(([key, provider]) => [key, { name: provider.name || (key === "lace" ? "Lace" : key), provider }]));
}

function showWallets() {
  const wallets = walletOptions();
  selectOptions($("wallet"), "Choose a wallet", Array.from(wallets, ([key, { name }]) => [key, name]));
  $("connect").disabled = !wallets.size || busy;
  const help = $("wallet-help");
  help.hidden = wallets.size > 0 && network === "ethereum-sepolia";
  help.textContent = !wallets.size
    ? "Open this link in a browser with a compatible wallet installed."
    : "Switch your Cardano wallet to Preview before connecting.";
}

window.addEventListener("eip6963:announceProvider", ({ detail }) => {
  if (!detail?.info?.uuid || !detail.info.name || typeof detail.provider?.request !== "function") return;
  ethereumWallets.set(detail.info.uuid, { name: detail.info.name, provider: detail.provider });
  if (!busy && activeStep === "wallet" && network === "ethereum-sepolia") showWallets();
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function paymentAssets() {
  return order.network
    ? [[order.asset, order.asset]]
    : order.paymentAssets.filter(asset => asset.network === network).map(({ symbol }) => [symbol, symbol]);
}

function showAssets() {
  const assets = paymentAssets();
  selectOptions($("asset"), "Choose an asset", assets, order.network ? order.asset : "");
  $("asset").disabled = Boolean(order.network);
  $("asset-locked").hidden = !order.network;
  $("balance").textContent = "";
  $("review").disabled = true;
  funded = undefined;
  prepared = undefined;
  setStep("asset");
}

async function connectWallet() {
  const wallet = walletOptions().get($("wallet").value);
  if (!wallet) throw new Error("Choose a wallet to continue.");
  if (network === "ethereum-sepolia") {
    const accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
    await switchSepolia(wallet.provider);
    if (!accounts?.[0]) throw new Error("Connect an Ethereum account first.");
    connected = { ...wallet, account: accounts[0] };
  } else {
    const api = await wallet.provider.enable();
    if (await api.getNetworkId() !== 0) throw new Error("Switch your Cardano wallet to Preview.");
    connected = { ...wallet, api, account: await api.getChangeAddress() };
  }
  showAssets();
  if (order.network) await checkFunds();
}

function ethereumQuantity(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) {
    throw new Error("The Ethereum wallet returned an invalid balance or fee.");
  }
  return BigInt(value);
}

async function ethereumPayment(quote) {
  const { provider, account } = connected;
  const tx = sepoliaPayment(quote, account);
  if (await provider.request({ method: "eth_chainId" }) !== SEPOLIA_CHAIN_ID) {
    throw new Error("Switch your Ethereum wallet to Sepolia.");
  }
  const rpc = (method, params = []) => provider.request({ method, params });
  const native = ethereumQuantity(await rpc("eth_getBalance", [account, "latest"]));
  const amount = BigInt(quote.amountAtomic);
  const isNative = quote.assetUnit === "native";
  const balance = isNative ? native : ethereumQuantity(await rpc("eth_call", [{
    to: quote.assetUnit,
    data: `0x70a08231${account.slice(2).toLowerCase().padStart(64, "0")}`,
  }, "latest"]));
  if (balance < amount) throw new Error(`Insufficient ${quote.asset}. Wallet balance: ${decimalAmount(balance, quote.decimals)} ${quote.asset}.`);
  const remaining = native - (isNative ? amount : 0n);
  const gasPrice = ethereumQuantity(await rpc("eth_gasPrice"));
  if (remaining < 21_000n * gasPrice) throw new Error("Insufficient Sepolia ETH for the network fee.");
  const gas = ethereumQuantity(await rpc("eth_estimateGas", [tx]));
  const fee = gas * gasPrice;
  if (remaining < fee) throw new Error("Insufficient Sepolia ETH for the network fee.");
  return { tx, fee: `Approximately ${decimalAmount(fee, 18)} ETH` };
}

async function cardanoInputs(quote) {
  const { api, account } = connected;
  if (await api.getNetworkId() !== 0 || await api.getChangeAddress() !== account) {
    throw new Error("Reconnect the Cardano wallet on Preview.");
  }
  let utxos = await api.getUtxos(cip30PaymentAmount(quote));
  if (!utxos?.length) {
    const balance = cip30WalletLovelace(await api.getBalance());
    const paymentAda = quote.assetUnit === "lovelace" ? BigInt(quote.amountAtomic) : 0n;
    const available = balance - paymentAda;
    if (available > 0n && available < CARDANO_FUNDING_BUFFER) {
      utxos = await api.getUtxos(cip30PaymentAmount(quote, available));
    }
    // Check whether the builder can fund the payment with a smaller ADA budget.
    if (!utxos?.length && available > 0n) utxos = await api.getUtxos(cip30PaymentAmount(quote, 0n));
  }
  if (!utxos?.length) throw new Error(`Insufficient ${quote.asset} or ADA to fund this payment.`);
  return { changeAddress: account, utxos };
}

async function cardanoPayment(quote, selection) {
  const inputs = await cardanoInputs(quote);
  const built = await request("cardano-tx", { ...inputs, ...selection });
  return {
    unsignedTx: built.unsignedTx,
    from: built.changeAddress,
    amountAtomic: built.recipientAmount,
    fee: `${decimalAmount(built.feeLovelace, 6)} ADA`,
    extra: quote.assetUnit === "lovelace" ? "" : `${decimalAmount(built.recipientLovelace, 6)} ADA`,
  };
}

async function checkFunds() {
  const asset = $("asset").value;
  funded = undefined;
  if (!asset) {
    $("balance").textContent = "";
    return;
  }
  $("balance").textContent = "Checking wallet funds…";
  try {
    const selection = { network, asset, paymentReference: order.message };
    const quote = order.network ? order : await request("select", { ...selection, preview: true });
    if (network === "ethereum-sepolia") await ethereumPayment(quote);
    else await cardanoPayment(quote, order.network ? undefined : { preview: true, ...selection });
    funded = selection;
    $("balance").textContent = `Wallet can cover ${decimalAmount(quote.amountAtomic, quote.decimals)} ${asset} and the estimated network fee.`;
  } catch (error) {
    $("balance").textContent = error.message;
  }
}

async function reviewPayment() {
  if (!funded) return;
  if (!order.network) await request("select", funded);
  order = await request("status");
  if (!walletPayKind(order)) {
    render(order);
    return;
  }
  try {
    const payment = network === "ethereum-sepolia" ? await ethereumPayment(order) : await cardanoPayment(order);
    prepared = { ...payment, quote: order };
  } catch (error) {
    showAssets();
    $("balance").textContent = error.message;
    return;
  }
  $("review-network").textContent = networks.get(network);
  $("review-wallet").textContent = connected.name;
  $("from").textContent = prepared.from ?? connected.account;
  $("recipient").textContent = order.recipient;
  $("amount").textContent = `${decimalAmount(prepared.amountAtomic ?? order.amountAtomic, order.decimals)} ${order.asset}`;
  $("extra").textContent = prepared.extra ?? "";
  $("extra").hidden = $("extra-label").hidden = !prepared.extra;
  $("fee").textContent = prepared.fee;
  $("expiry").textContent = new Date(order.expiresAt).toLocaleString();
  setStep("review");
}

function showProgress(message, spinning = true, count) {
  setStep("confirmation");
  if ($("status").textContent !== message) $("status").textContent = message;
  $("spinner").hidden = !spinning;
  $("confirmations").hidden = count === undefined;
  if (count !== undefined) {
    $("confirmations").max = order.confirmations;
    $("confirmations").value = count;
  }
}

function showRestart(previousStep) {
  const canRestart = order.canRestart === true;
  restartReturnStep = previousStep;
  $("restart-step").querySelector("h2").textContent = previousStep
    ? "Change network or asset"
    : order.network ? "Your quote expired" : "Your reservation expired";
  $("restart-form").hidden = !canRestart;
  $("cancel-restart").hidden = !previousStep;
  $("no-payment-label").hidden = !order.network;
  $("no-payment").required = Boolean(order.network);
  if (activeStep !== "restart") $("no-payment").checked = false;
  const message = canRestart && order.network
    ? "Close any open wallet payment prompts. If you already sent payment, keep the transaction ID and contact support before starting over."
    : canRestart
      ? "Start a new quote to choose a network and asset."
      : "Refresh status or check this order in the app.";
  if ($("restart-status").textContent !== message) $("restart-status").textContent = message;
  setStep("restart");
}

async function restartPayment() {
  if (!globalThis.navigator?.locks) throw new Error("Open checkout in a browser that supports wallet payments across tabs.");
  await navigator.locks.request(hashStorageKey, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Payment is already open in another tab.");
    restoreSavedPayment();
    uncertain ||= readUncertain();
    if (savedHash || uncertain) {
      render(await request("status"));
      return;
    }
    await request("restart", {
      noPaymentSent: $("no-payment").checked,
      paymentReference: order.message,
    });
    activeStep = undefined;
    network = "";
    connected = funded = prepared = undefined;
    render(await request("status"));
  });
}

function render(snapshot) {
  const testSite = localTest || location.hostname === "test.pqpost.com";
  const isTest = snapshot.testnet === true || networks.has(snapshot.network);
  if (testSite !== isTest) throw new Error("The order is for a different network environment.");
  const changedQuote = order?.network !== snapshot.network || order?.message !== snapshot.message;
  order = snapshot;
  $("testnet").hidden = !isTest;
  $("email").textContent = order.email;
  $("price").textContent = `$${(order.usdCents / 100).toFixed(2)} USD`;
  $("loading").hidden = true;
  $("order").hidden = false;
  $("refresh").hidden = false;
  const complete = ["confirmed", "fulfilled"].includes(order.status);
  if (savedHash && (complete || normalizeHash(savedHash) === normalizeHash(order.transactionId))) saveHash("");
  if (complete || order.transactionId) markUncertain(false);
  const retiredPayment = savedHash && savedReference && savedReference !== order.message;
  renderTransactionLink({ ...order, transactionId: order.confirmationTransactionId ?? order.transactionId ?? (retiredPayment ? "" : savedHash) });
  $("confirmation-title").textContent = complete ? "Payment confirmed" : "Payment status";
  $("recover").hidden = !savedHash || retiredPayment || !["quoted", "pending"].includes(order.status);
  if (complete) {
    showProgress("Payment received. Return to the app and select “Check payment” to finish setting up your address.", false);
  } else if (order.status === "cancelled") {
    showProgress("This purchase was cancelled. If you already paid, contact support with your transaction ID.", false);
  } else if (order.status === "manual_review") {
    showProgress("This payment needs review. Contact support with your transaction ID.", false);
  } else if (retiredPayment) {
    showProgress(`Your wallet sent a transaction for a previous quote. Contact support with transaction ID ${savedHash}.`, false);
  } else if (savedHash) {
    showProgress(order.status === "expired"
      ? "Your wallet sent a transaction for this order. Contact support with the transaction ID."
      : "Your wallet sent the transaction. Record it to start checking for confirmations.", false);
  } else if (order.status === "pending" && order.paymentMismatch) {
    showProgress("The submitted transaction does not match this payment. Contact support with your transaction ID.", false);
  } else if (order.status === "pending") {
    const count = order.confirmationsSeen;
    showProgress(count > 0
      ? `${count} of ${order.confirmations} block confirmations`
      : count === 0 ? "Waiting for the transaction to be included in a block…"
      : "Checking the transaction on the network…", true, count > 0 ? count : undefined);
  } else if (uncertain) {
    showProgress("Your wallet did not confirm whether it sent the payment. Check your wallet history and contact support before trying again.", false);
  } else if (order.status === "expired" ||
    (order.status === "quoted" && order.network && order.expiresAt <= Date.now())) {
    showRestart();
  } else if (order.network && !walletPayKind(order)) {
    showProgress("This quote is no longer payable. Return to the app to check your order.", false);
  } else if (activeStep === "restart" && restartReturnStep && !changedQuote) {
    showRestart(restartReturnStep);
  } else if (!activeStep || activeStep === "confirmation" || activeStep === "restart" || changedQuote) {
    const available = order.network ? [order.network] : (order.paymentAssets ?? []).map(({ network }) => network);
    const options = Array.from(new Set(available)).filter(value => networks.has(value));
    selectOptions($("network"), "Choose a network", options.map(value => [value, networks.get(value)]), order.network ?? "");
    $("network").disabled = Boolean(order.network);
    setStep("network");
    if (!options.length) showError("Payment networks are unavailable. Refresh status to try again.");
  }
}

async function recordPayment() {
  const recorded = await request("transaction", { transactionId: savedHash, paymentReference: savedReference });
  saveHash("");
  render(recorded);
}

async function sendPayment() {
  if (!globalThis.navigator?.locks) throw new Error("Open checkout in a browser that supports wallet payments across tabs.");
  await navigator.locks.request(hashStorageKey, { ifAvailable: true }, async lock => {
    if (!lock) throw new Error("Payment is already open in another tab.");
    restoreSavedPayment();
    if (savedHash) {
      showProgress("Recording the transaction…");
      await recordPayment();
      return;
    }
    showProgress("Checking the reviewed transaction…");
    const current = await request("status");
    if (!walletPayKind(current) || readUncertain() || uncertain) {
      uncertain ||= readUncertain();
      render(current);
      return;
    }
    const { quote, tx, unsignedTx } = prepared;
    if (["network", "asset", "assetUnit", "amountAtomic", "recipient", "message", "expiresAt"]
      .some(key => current[key] !== quote[key])) {
      throw new Error("The quote changed. Go back and review the payment again.");
    }
    let broadcast;
    if (tx) {
      const accounts = await connected.provider.request({ method: "eth_accounts" });
      if (accounts?.[0]?.toLowerCase() !== tx.from.toLowerCase()) throw new Error("The active wallet account changed. Reconnect your wallet.");
      await ethereumPayment(current);
      broadcast = () => connected.provider.request({ method: "eth_sendTransaction", params: [tx] });
    } else {
      if (await connected.api.getNetworkId() !== 0 || await connected.api.getChangeAddress() !== connected.account) {
        throw new Error("The Cardano wallet changed. Reconnect it on Preview.");
      }
      showProgress("Waiting for you to approve the payment in your wallet…");
      const witnessSet = await connected.api.signTx(unsignedTx, false);
      const { signedTx } = await request("cardano-assemble", { unsignedTx, witnessSet });
      broadcast = () => connected.api.submitTx(signedTx);
    }
    if (Date.now() >= current.expiresAt) throw new Error("The quote expired before the transaction could be sent.");
    showProgress(tx ? "Waiting for you to approve the payment in your wallet…" : "Sending the signed transaction…");
    // Retain an uncertain send across reloads, even if the browser closes during approval.
    markUncertain(true);
    let hash;
    try {
      hash = await broadcast();
    } catch (error) {
      if (tx && error?.code === 4001) markUncertain(false);
      throw error;
    }
    if (typeof hash !== "string" || !(tx ? /^0x[0-9a-f]{64}$/i : /^[0-9a-f]{64}$/i).test(hash)) {
      throw new Error("The wallet did not return a transaction ID.");
    }
    saveHash(hash, current.message);
    markUncertain(false);
    showProgress("Recording the transaction…");
    await recordPayment();
  });
}

function syncControls() {
  for (const button of document.querySelectorAll("button")) button.disabled = busy;
  $("review").disabled = busy || !funded;
  $("check-funds").hidden = !($("asset").value && !funded);
  $("connect").disabled = busy || !walletOptions().size;
  $("network").disabled = busy || Boolean(order?.network);
  $("wallet").disabled = busy;
  $("asset").disabled = busy || Boolean(order?.network);
}

async function run(action, onError = () => {}) {
  if (busy) return;
  clearTimeout(poll);
  busy = true;
  showError("");
  syncControls();
  try {
    await action();
  } catch (error) {
    showError(error.message || "Checkout could not complete this step. Try again.");
    onError();
  } finally {
    busy = false;
    syncControls();
    if (order?.status === "pending" && !savedHash) {
      poll = setTimeout(refresh, 12_000);
    } else if (order?.status === "quoted" && !savedHash && !uncertain) {
      const next = order.expiresAt;
      if (Number.isFinite(next) && next > Date.now()) {
        poll = setTimeout(refresh, next - Date.now() + 500);
      }
    }
  }
}

function refresh() {
  return run(async () => render(await request("status")), () => {
    $("loading").hidden = true;
    if (!order) {
      $("order").hidden = false;
      $("refresh").hidden = false;
    }
  });
}

function form(id, action) {
  $(id).addEventListener("submit", event => {
    event.preventDefault();
    void run(action);
  });
}

form("network-form", () => {
  network = order.network || $("network").value;
  if (!networks.has(network)) return;
  showWallets();
  setStep("wallet");
});
form("restart-form", restartPayment);
$("change-payment").addEventListener("click", () => { showError(""); showRestart(activeStep); });
$("cancel-restart").addEventListener("click", () => { showError(""); setStep(restartReturnStep); });
form("wallet-form", connectWallet);
form("asset-form", reviewPayment);
$("asset").addEventListener("change", () => void run(checkFunds));
$("check-funds").addEventListener("click", () => void run(checkFunds));
$("back-network").addEventListener("click", () => { showError(""); setStep("network"); });
$("back-wallet").addEventListener("click", () => { showError(""); showWallets(); setStep("wallet"); });
$("back-asset").addEventListener("click", () => void run(async () => { showAssets(); await checkFunds(); }));
$("send").addEventListener("click", () => void run(sendPayment, () => {
  if (savedHash || uncertain) render(order);
  else setStep("review");
}));
$("recover").addEventListener("click", () => void run(recordPayment));
$("refresh").addEventListener("click", refresh);

if (!apiOrigin || !validId.test(id)) {
  $("loading").hidden = true;
  showError("Open checkout from the link in your pqpost app.");
} else {
  void refresh();
}
