/** Pure checks for payment evidence obtained from trusted mainnet RPC providers.
 * These functions do not grant an entitlement or check whether a transaction was
 * previously used; callers must do both atomically in the order store.
 */
export type PaymentCheck = "confirmed" | "pending" | "invalid";

export type PaymentExpectation = {
  recipient: string;
  amount: bigint;
  message: string;
  confirmations: number;
};

const TRANSFER_EVENT =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const TRANSFER_SELECTOR = "a9059cbb";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/;

function hexInteger(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function hexBytes(value: string): string {
  return Array.from(
    new TextEncoder().encode(value),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validExpectation(expected: PaymentExpectation): boolean {
  return expected.amount > 0n && expected.message.length > 0 &&
    Number.isSafeInteger(expected.confirmations) && expected.confirmations > 0;
}

type EthereumTransaction = {
  hash?: string;
  to?: string | null;
  value?: string;
  input?: string;
  blockHash?: string | null;
  blockNumber?: string | null;
};
type EthereumLog = {
  address?: string;
  topics?: string[];
  data?: string;
  removed?: boolean;
};
type EthereumReceipt = {
  transactionHash?: string;
  blockHash?: string;
  blockNumber?: string;
  status?: string;
  logs?: EthereumLog[];
};

/** Verify an Ethereum receipt against the explicitly selected network. */
export function checkEthereumPayment(input: {
  txHash: string;
  chainId: string;
  network: "mainnet" | "sepolia";
  transaction: EthereumTransaction | null;
  receipt: EthereumReceipt | null;
  canonicalBlockHash: string | null;
  latestBlock: string;
  tokenContract?: string;
  expected: PaymentExpectation;
}): PaymentCheck {
  const { expected, transaction: tx, receipt } = input;
  const recipient = expected.recipient.toLowerCase();
  const hash = input.txHash.toLowerCase();
  if (
    !validExpectation(expected) || !ADDRESS.test(recipient) ||
    !/^0x[0-9a-f]{64}$/.test(hash) ||
    hexInteger(input.chainId) !==
      (input.network === "sepolia" ? 11155111n : 1n) ||
    (input.tokenContract !== undefined &&
      !ADDRESS.test(input.tokenContract.toLowerCase()))
  ) return "invalid";
  if (!tx || !receipt) return "pending";
  const block = hexInteger(receipt.blockNumber);
  const latest = hexInteger(input.latestBlock);
  if (
    tx.hash?.toLowerCase() !== hash ||
    receipt.transactionHash?.toLowerCase() !== hash ||
    hexInteger(receipt.status) !== 1n || block === null || latest === null ||
    latest < block ||
    !receipt.blockHash || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash) ||
    tx.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() ||
    hexInteger(tx.blockNumber) !== block ||
    input.canonicalBlockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()
  ) return "invalid";
  const data = tx.input?.toLowerCase() ?? "";
  if (!HEX_DATA.test(data)) return "invalid";
  const message = hexBytes(expected.message);
  if (input.tokenContract === undefined) {
    const amount = hexInteger(tx.value);
    if (
      tx.to?.toLowerCase() !== recipient || amount === null ||
      amount < expected.amount ||
      data !== `0x${message}`
    ) return "invalid";
  } else {
    const contract = input.tokenContract.toLowerCase();
    // ABI transfer(address,uint256), followed by the exact UTF-8 order message.
    const prefix = `0x${TRANSFER_SELECTOR}${
      recipient.slice(2).padStart(64, "0")
    }`;
    if (
      tx.to?.toLowerCase() !== contract || !data.startsWith(prefix) ||
      data.length !== prefix.length + 64 + message.length ||
      !data.endsWith(message)
    ) return "invalid";
    const amount = hexInteger(
      `0x${data.slice(prefix.length, prefix.length + 64)}`,
    );
    if (amount === null || amount < expected.amount) return "invalid";
    const recipientTopic = `0x${recipient.slice(2).padStart(64, "0")}`;
    const matching = (receipt.logs ?? []).filter((log) => {
      const received = hexInteger(log.data);
      return !log.removed && log.address?.toLowerCase() === contract &&
        log.topics?.length === 3 &&
        log.topics[0]?.toLowerCase() === TRANSFER_EVENT &&
        /^0x[0-9a-f]{64}$/i.test(log.topics[1] ?? "") &&
        log.topics[2]?.toLowerCase() === recipientTopic &&
        /^0x[0-9a-f]{64}$/i.test(log.data ?? "") && received !== null &&
        received >= expected.amount;
    });
    if (matching.length !== 1) return "invalid";
  }
  return latest - block + 1n >= BigInt(expected.confirmations)
    ? "confirmed"
    : "pending";
}

type CardanoOutput = {
  address?: string;
  amount?: Array<{ unit?: string; quantity?: string }>;
};
/** Verify transaction metadata, outputs and canonical block evidence from Blockfrost mainnet. */
export function checkCardanoPayment(input: {
  txHash: string;
  transaction: { hash?: string; block?: string; block_height?: number } | null;
  outputs: CardanoOutput[];
  metadata: Array<{ label?: string; json_metadata?: unknown }>;
  canonicalBlockHash: string | null;
  latestHeight: number;
  assetUnit: string; // lovelace, or policy ID concatenated with hex asset name
  expected: PaymentExpectation;
}): PaymentCheck {
  const { expected, transaction: tx } = input;
  if (
    !validExpectation(expected) || !expected.recipient ||
    !/^[0-9a-f]{64}$/i.test(input.txHash) ||
    !(input.assetUnit === "lovelace" ||
      /^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(input.assetUnit)) ||
    !Number.isSafeInteger(input.latestHeight) || input.latestHeight < 0
  ) return "invalid";
  if (!tx) return "pending";
  if (
    tx.hash?.toLowerCase() !== input.txHash.toLowerCase() ||
    typeof tx.block !== "string" || !/^[0-9a-f]{64}$/i.test(tx.block) ||
    tx.block.toLowerCase() !== input.canonicalBlockHash?.toLowerCase() ||
    !Number.isSafeInteger(tx.block_height) || tx.block_height! < 0 ||
    tx.block_height! > input.latestHeight
  ) return "invalid";
  const messages = input.metadata.filter((item) => item.label === "674");
  const body = messages[0]?.json_metadata as { msg?: unknown } | null;
  if (
    messages.length !== 1 || !body || !Array.isArray(body.msg) ||
    body.msg.length !== 1 || body.msg[0] !== expected.message
  ) return "invalid";
  let total = 0n;
  for (const output of input.outputs) {
    if (output.address !== expected.recipient) continue;
    for (const item of output.amount ?? []) {
      if (item.unit !== input.assetUnit) continue;
      if (
        typeof item.quantity !== "string" || !/^[0-9]+$/.test(item.quantity)
      ) return "invalid";
      total += BigInt(item.quantity);
    }
  }
  if (total < expected.amount) return "invalid";
  return input.latestHeight - tx.block_height! + 1 >= expected.confirmations
    ? "confirmed"
    : "pending";
}
