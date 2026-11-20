const SEPOLIA_ID = "0xaa36a7";
const ETH_ADDRESS = /^0x[0-9a-f]{40}$/i;
const ETH_HASH = /^0x[0-9a-f]{64}$/i;
const STORAGE_KEY = "pqpost-testnet-mints-v1";
const $ = (id) => document.getElementById(id);
let catalog;
let busy = false;
let mints = {};
try {
  mints = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
} catch {
  // A fresh browser session starts without mint history.
}

async function request(path, body) {
  const response = await fetch(
    path,
    body === undefined ? undefined : {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}

function status(message, error = false) {
  $("activity").textContent = message;
  $("activity").dataset.error = String(error);
}

function amount() {
  const value = $("amount").value.trim();
  if (!/^[1-9][0-9]{0,11}$/.test(value)) {
    throw new Error(
      "Enter a positive whole-token amount with at most 12 digits.",
    );
  }
  return value;
}

function store(key, mint) {
  if (mint) mints[key] = mint;
  else delete mints[key];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(mints));
}

function button(title, action, disabled = false) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = title;
  element.disabled = busy || disabled;
  element.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    render();
    try {
      await action();
    } catch (error) {
      status(error?.message ?? String(error), true);
    } finally {
      busy = false;
      render();
    }
  });
  return element;
}

function pendingActions(key, check) {
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(
    button("Check", check),
    button("Forget", () => {
      if (
        window.confirm(
          "Forget this transaction locally? Check your wallet history first. Forgetting it cannot cancel it on-chain.",
        )
      ) {
        store(key, null);
        status("Pending transaction removed from this page.");
      }
    }),
  );
  return actions;
}

function row(container, label, detail, action) {
  const item = document.createElement("div");
  item.className = "asset-row";
  const text = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = label;
  const subtitle = document.createElement("small");
  subtitle.textContent = detail;
  text.append(name, subtitle);
  item.append(text, action);
  container.append(item);
}

function render() {
  const ethereum = $("sepolia-assets");
  ethereum.replaceChildren();
  for (const symbol of catalog.sepolia) {
    const mint = mints[symbol];
    row(
      ethereum,
      symbol,
      mint?.unit
        ? `Confirmed · ${mint.unit}`
        : mint
        ? "Awaiting confirmation"
        : "ERC-20",
      mint?.unit
        ? button("Add to wallet", () => addSepoliaToWallet(symbol))
        : mint
        ? pendingActions(symbol, () => checkSepolia(symbol))
        : button("Mint", () => mintSepolia(symbol)),
    );
  }
  const preview = $("preview-assets");
  preview.replaceChildren();
  row(
    preview,
    catalog.preview.join(" · "),
    mints.preview?.confirmed
      ? "Confirmed"
      : mints.preview
      ? "Awaiting confirmation"
      : "Five assets in one transaction",
    mints.preview?.confirmed
      ? button("Minted", () => {}, true)
      : mints.preview
      ? pendingActions("preview", checkPreview)
      : button("Mint all", mintPreview, !$("cardano-wallet").value),
  );
  renderExport();
}

function ethereumWallet() {
  const wallet = window.ethereum;
  if (!wallet?.request) {
    throw new Error("Open this page in a browser with an Ethereum wallet.");
  }
  return wallet;
}

async function useSepolia(wallet) {
  if (await wallet.request({ method: "eth_chainId" }) === SEPOLIA_ID) return;
  await wallet.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: SEPOLIA_ID }],
  });
  if (await wallet.request({ method: "eth_chainId" }) !== SEPOLIA_ID) {
    throw new Error("Switch your Ethereum wallet to Sepolia.");
  }
}

export function constructorData(symbol, account, supply) {
  const word = (value) => value.toString(16).padStart(64, "0");
  const bytes = new TextEncoder().encode(symbol);
  const name = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return word(96) + account.slice(2).toLowerCase().padStart(64, "0") +
    word(supply) + word(bytes.length) + name.padEnd(64, "0");
}

async function mintSepolia(symbol) {
  const supply = BigInt(amount()) * 10n ** BigInt(catalog.decimals);
  const wallet = ethereumWallet();
  status("Compiling the Sepolia contract locally…");
  const { bytecode } = await request("/api/bytecode", {});
  await useSepolia(wallet);
  const [account] = await wallet.request({ method: "eth_requestAccounts" });
  if (!ETH_ADDRESS.test(account)) {
    throw new Error("Connect a Sepolia account first.");
  }
  await useSepolia(wallet);
  status(`Approve the ${symbol} contract deployment in your Ethereum wallet.`);
  let hash;
  try {
    hash = await wallet.request({
      method: "eth_sendTransaction",
      params: [{
        from: account,
        data: bytecode + constructorData(symbol, account, supply),
        value: "0x0",
      }],
    });
  } catch (error) {
    if (error?.code === 4001) throw error;
    throw new Error(
      "The wallet did not confirm submission. Check its transaction history before minting again.",
    );
  }
  if (!ETH_HASH.test(hash)) {
    throw new Error(
      "Check your wallet history for the deployment transaction hash.",
    );
  }
  store(symbol, { hash });
  status(
    `Submitted ${symbol} · ${hash}. Check when Sepolia has included the transaction.`,
  );
}

async function checkSepolia(symbol) {
  const wallet = ethereumWallet();
  await useSepolia(wallet);
  const { hash } = mints[symbol];
  const receipt = await wallet.request({
    method: "eth_getTransactionReceipt",
    params: [hash],
  });
  if (!receipt) {
    status(`Waiting for Sepolia · ${hash}`);
    return;
  }
  if (receipt.status === "0x0") {
    store(symbol, null);
    throw new Error(`The ${symbol} deployment reverted. You can try again.`);
  }
  if (receipt.status !== "0x1" || !ETH_ADDRESS.test(receipt.contractAddress)) {
    throw new Error(
      `The wallet did not return a confirmed contract address for ${hash}.`,
    );
  }
  store(symbol, { hash, unit: receipt.contractAddress });
  status(`${symbol} confirmed · ${receipt.contractAddress}`);
}

async function addSepoliaToWallet(symbol) {
  const address = mints[symbol]?.unit;
  if (!ETH_ADDRESS.test(address ?? "")) {
    throw new Error(`Confirm the ${symbol} mint before adding it to the wallet.`);
  }
  const wallet = ethereumWallet();
  await useSepolia(wallet);
  await wallet.request({ method: "eth_requestAccounts" });
  const params = {
    type: "ERC20",
    options: { address, symbol, decimals: catalog.decimals },
  };
  let added;
  try {
    added = await wallet.request({ method: "wallet_watchAsset", params });
  } catch (error) {
    if (error?.code === 4001) throw new Error("The wallet dismissed the token.");
    added = await wallet.request({
      method: "wallet_watchAsset",
      params: [params],
    });
  }
  if (added === false) throw new Error(`The wallet did not add ${symbol}.`);
  status(`${symbol} added to the wallet · ${address}`);
}

async function mintPreview() {
  const whole = amount();
  const wallet = await window.cardano[$("cardano-wallet").value].enable();
  if (await wallet.getNetworkId() !== 0) {
    throw new Error("Switch your Cardano wallet to Preview.");
  }
  status("Looking up the wallet’s inputs on Cardano Preview…");
  const changeAddress = await wallet.getChangeAddress();
  const utxos = await wallet.getUtxos();
  const { unsigned, tokens } = await request("/api/preview/build", {
    amount: whole,
    changeAddress,
    utxos,
  });
  status("Approve the five-asset mint in your Cardano wallet.");
  const witness = await wallet.signTx(unsigned, true);
  const { signed, hash } = await request("/api/preview/assemble", {
    unsigned,
    witness,
  });
  status("Submitting the signed transaction through your Cardano wallet…");
  try {
    if ((await wallet.submitTx(signed)).toLowerCase() !== hash) {
      throw new Error("Unexpected transaction hash.");
    }
  } catch {
    status(
      `Submission could not be verified. Check wallet history and Preview status for ${hash}.`,
      true,
    );
    store("preview", { hash, tokens });
    return;
  }
  store("preview", { hash, tokens });
  status(
    `Submitted Cardano mint · ${hash}. Check when Preview has included the transaction.`,
  );
}

async function checkPreview() {
  const mint = mints.preview;
  const { confirmed } = await request("/api/preview/status", {
    hash: mint.hash,
  });
  if (confirmed) store("preview", { ...mint, confirmed });
  status(
    confirmed
      ? `Cardano mint confirmed · ${mint.hash}`
      : `Waiting for Preview · ${mint.hash}`,
  );
}

function receivingAddress(network) {
  if (network === "ethereum-sepolia") {
    const address = $("sepolia-recipient").value.trim();
    return ETH_ADDRESS.test(address) && !/^0x0{40}$/i.test(address)
      ? address
      : "";
  }
  const address = $("preview-recipient").value.trim();
  return /^addr_test1[023456789acdefghjklmnpqrstuvwxyz]{50,}$/.test(address)
    ? address
    : "";
}

function serverAssets() {
  const entries = [];
  const add = (asset, gaps) => entries.push({ asset, gaps });
  const sepolia = receivingAddress("ethereum-sepolia");
  const preview = receivingAddress("cardano-preview");
  if ($("native-eth").checked) {
    add({
      network: "ethereum-sepolia",
      symbol: "ETH",
      recipient: sepolia,
      unit: "native",
      decimals: 18,
    }, sepolia ? [] : ["recipient"]);
  }
  for (const symbol of catalog.sepolia) {
    const unit = ETH_ADDRESS.test(mints[symbol]?.unit ?? "")
      ? mints[symbol].unit
      : "";
    const gaps = [];
    if (!sepolia) gaps.push("recipient");
    if (!unit) gaps.push("unit");
    add({
      network: "ethereum-sepolia",
      symbol,
      recipient: sepolia,
      unit,
      decimals: catalog.decimals,
    }, gaps);
  }
  if ($("native-ada").checked) {
    add({
      network: "cardano-preview",
      symbol: "ADA",
      recipient: preview,
      unit: "lovelace",
      decimals: 6,
    }, preview ? [] : ["recipient"]);
  }
  for (const symbol of catalog.preview) {
    const token = mints.preview?.tokens?.find((item) => item.symbol === symbol);
    const known = typeof token?.unit === "string" ? token.unit : "";
    const confirmed = Boolean(mints.preview?.confirmed && known);
    const gaps = [];
    if (!preview) gaps.push("recipient");
    if (!confirmed) gaps.push("unit");
    add({
      network: "cardano-preview",
      symbol,
      recipient: preview,
      unit: known,
      decimals: catalog.decimals,
    }, gaps);
  }
  return entries;
}

function fieldText(asset, name, missing) {
  if (!missing) return String(asset[name]);
  if (name === "recipient") {
    return asset.network === "ethereum-sepolia"
      ? "Enter the Sepolia address that will receive checkout payments"
      : "Enter the Preview address that will receive checkout payments";
  }
  return asset.network === "ethereum-sepolia"
    ? "Confirm the Sepolia mint to get the contract address"
    : "Confirm the Preview mint to get the asset ID";
}

function renderExport() {
  const entries = serverAssets();
  const list = $("asset-list");
  list.replaceChildren();
  for (const { asset, gaps } of entries) {
    const card = document.createElement("article");
    card.className = "asset-detail";
    const heading = document.createElement("h3");
    heading.textContent = `${asset.symbol} · ${asset.network}`;
    const note = document.createElement("p");
    note.textContent = gaps.includes("unit") && asset.unit
      ? "The asset ID is known. It stays out of the JSON until the mint is confirmed."
      : gaps.length
      ? "Not included in the JSON until every field is filled."
      : "Included in the JSON below.";
    const fields = document.createElement("dl");
    for (const name of ["network", "symbol", "recipient", "unit", "decimals"]) {
      const term = document.createElement("dt");
      term.textContent = name;
      const value = document.createElement("dd");
      const pendingUnit = name === "unit" && gaps.includes("unit") &&
        asset.unit;
      const missing = gaps.includes(name) && !pendingUnit;
      value.textContent = pendingUnit
        ? asset.unit
        : fieldText(asset, name, missing);
      if (missing) value.className = "missing";
      fields.append(term, value);
    }
    card.append(heading, note, fields);
    list.append(card);
  }
  const assets = entries.filter((entry) => entry.gaps.length === 0).map((
    entry,
  ) => entry.asset);
  $("output").value = JSON.stringify(assets, null, 2);
  $("download").disabled = assets.length === 0;
}

function addWalletOption(select, label, value) {
  const option = document.createElement("option");
  option.textContent = label;
  option.value = value;
  select.append(option);
}

async function start() {
  catalog = await request("/api/assets");
  const select = $("cardano-wallet");
  for (const [name, wallet] of Object.entries(window.cardano ?? {})) {
    if (typeof wallet?.enable === "function") {
      addWalletOption(select, wallet.name ?? name, name);
    }
  }
  if (!select.length) {
    addWalletOption(select, "No CIP-30 wallet detected", "");
    select.disabled = true;
  }
  for (
    const id of [
      "sepolia-recipient",
      "preview-recipient",
      "native-eth",
      "native-ada",
    ]
  ) {
    $(id).addEventListener("input", renderExport);
  }
  $("download").addEventListener("click", () => {
    const blob = new Blob([$("output").value + "\n"], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "test-payment-assets.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
}

if (typeof document !== "undefined") {
  start().catch((error) => status(error.message, true));
}
