/** Test-address checkout decisions shared by the page and the unit tests. */

export const SEPOLIA_CHAIN_ID = "0xaa36a7";
export const TEST_MAIL_DOMAIN = "test.pqpost.com";

export function messageInput(message) {
  const hex = Array.from(new TextEncoder().encode(message), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `0x${hex}`;
}

/** Compact 0x quantity. Zero is 0x0, and there are no leading zeros. */
export function quantityHex(atomic) {
  const value = BigInt(atomic);
  if (value < 0n) throw new Error("amount must be positive");
  return `0x${value.toString(16)}`;
}

/** Wallet payment is available for live test-address quotes. */
export function walletPayKind(order) {
  if (!order || order.status !== "quoted" || !Number.isFinite(order.expiresAt) || order.expiresAt <= Date.now()) return null;
  if (typeof order.email !== "string" || !order.email.endsWith(`@${TEST_MAIL_DOMAIN}`)) {
    return null;
  }
  if (
    order.network === "ethereum-sepolia" && (order.asset === "ETH"
      ? order.assetUnit === "native"
      : /^0x[0-9a-f]{40}$/i.test(order.assetUnit))
  ) return "ethereum";
  if (
    order.network === "cardano-preview" && (order.asset === "ADA"
      ? order.assetUnit === "lovelace"
      : /^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(order.assetUnit))
  ) return "cardano";
  return null;
}

export function sepoliaPayment(order, from) {
  if (walletPayKind(order) !== "ethereum") {
    throw new Error("This order cannot be paid on Sepolia.");
  }
  if (typeof from !== "string" || !/^0x[0-9a-f]{40}$/i.test(from)) {
    throw new Error("Connect an Ethereum account first.");
  }
  const native = order.assetUnit === "native";
  return {
    from,
    chainId: SEPOLIA_CHAIN_ID,
    to: native ? order.recipient : order.assetUnit,
    value: native ? quantityHex(order.amountAtomic) : "0x0",
    data: native ? messageInput(order.message) : tokenPaymentData(order),
  };
}

export function tokenPaymentData(order) {
  const recipient = order.recipient.slice(2).toLowerCase().padStart(64, "0");
  const amount = quantityHex(order.amountAtomic).slice(2).padStart(64, "0");
  return `0xa9059cbb${recipient}${amount}${messageInput(order.message).slice(2)}`;
}

/** CIP-30 amount is a CBOR Value, here a positive lovelace integer. */
export function cip30LovelaceAmount(amount) {
  const n = BigInt(amount);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error("Invalid wallet amount");
  if (n < 24n) return n.toString(16).padStart(2, "0");
  for (const [bytes, prefix] of [[1, "18"], [2, "19"], [4, "1a"], [8, "1b"]]) {
    if (n < (1n << BigInt(bytes * 8))) return prefix + n.toString(16).padStart(bytes * 2, "0");
  }
}

/** CIP-30 Value for the quoted asset and the ADA needed for fees and outputs. */
export function cip30PaymentAmount(order) {
  const amount = BigInt(order.amountAtomic);
  const feeBuffer = 3_000_000n;
  if (order.assetUnit === "lovelace") return cip30LovelaceAmount(amount + feeBuffer);

  const [unit, policy, name] = /^([0-9a-f]{56})((?:[0-9a-f]{2}){0,32})$/.exec(order.assetUnit) ?? [];
  if (!unit || amount <= 0n) throw new Error("Invalid Cardano payment asset or amount.");
  const nameLength = name.length / 2;
  const nameHeader = nameLength < 24
    ? (0x40 + nameLength).toString(16)
    : `58${nameLength.toString(16)}`;
  // [lovelace, { policy ID: { asset name: quantity } }]
  return `82${cip30LovelaceAmount(feeBuffer)}a1581c${policy}a1${nameHeader}${name}${cip30LovelaceAmount(amount)}`;
}
