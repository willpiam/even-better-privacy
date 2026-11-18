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
  if (order.assetUnit !== "native") {
    return { from, to: order.assetUnit, value: "0x0", data: tokenPaymentData(order) };
  }
  return {
    from,
    to: order.recipient,
    value: quantityHex(order.amountAtomic),
    data: messageInput(order.message),
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
