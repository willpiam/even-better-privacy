// The API origins are intentionally fixed: a link cannot redirect an order to an attacker.
const localTest = location.origin === "http://127.0.0.1:8789";
const apiOrigin = localTest ? location.origin : location.hostname === "pqpost.com" ? "https://ebp-cqyo.onrender.com"
  : location.hostname === "test.pqpost.com" ? "https://test-api.pqpost.com" : "";
let id = "";
try { id = decodeURIComponent(location.hash.slice(1)); } catch { /* invalid link */ }
const $ = (id) => document.getElementById(id);
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let busy = false;
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
function render(order) {
  for (const key of ["email", "fingerprint", "network", "recipient", "message", "status"]) $(key).textContent = order[key];
  $("price").textContent = `$${(order.usdCents / 100).toFixed(2)} USD`;
  $("confirmations").textContent = String(order.confirmations);
  $("amount").textContent = `${decimalAmount(order.amountAtomic, order.decimals)} ${order.asset}`;
  $("expiry").textContent = new Date(order.expiresAt).toLocaleString();
  $("instructions").replaceChildren();
  const test = order.network === "ethereum-sepolia" || order.network === "cardano-preview";
  if ((localTest || location.hostname === "test.pqpost.com") !== test) throw new Error("The order is for a different network environment.");
  $("testnet").hidden = !test;
  if (order.network.startsWith("cardano-")) {
    addInstruction("Send the exact asset and amount to the receiving address above. Include the payment message as the only entry in the CIP-20 msg array under metadata label 674. For native tokens, your wallet must also include the minimum ADA required by Cardano.");
    if (order.assetUnit !== "lovelace") addInstruction("Cardano asset identifier:", order.assetUnit);
  } else {
    const messageHex = Array.from(new TextEncoder().encode(order.message), b => b.toString(16).padStart(2, "0")).join("");
    if (order.assetUnit === "native") {
      addInstruction("Send the ETH amount to the receiving address using a wallet that allows custom transaction input data. Set input data to:", `0x${messageHex}`);
    } else {
      const calldata = `0xa9059cbb${order.recipient.slice(2).toLowerCase().padStart(64, "0")}${BigInt(order.amountAtomic).toString(16).padStart(64, "0")}${messageHex}`;
      addInstruction(`Send a zero-ETH transaction to the ${order.asset} token contract below using a wallet that supports custom input data. Do not use a normal token-send screen that discards the message. Confirm the wallet shows the expected token transfer before signing.`, order.assetUnit);
      addInstruction("Transaction input data:", calldata);
    }
  }
  $("transaction-form").hidden = order.status !== "quoted";
  $("loading").hidden = true; $("order").hidden = false;
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
$("transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (busy) return; busy = true; showError("");
  try { render(await request("transaction", { transactionId: $("transaction").value.trim() })); }
  catch (error) { showError(`${error.message} Refresh status before retrying.`); }
  finally { busy = false; }
});
if (!apiOrigin || !validId.test(id)) { $("loading").hidden = true; showError("Open the checkout link from your pqpost app."); }
else void refresh();
