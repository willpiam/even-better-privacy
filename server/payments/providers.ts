import {
  checkCardanoPayment,
  checkEthereumPayment,
  type PaymentCheck,
  type PaymentExpectation,
} from "./verification.ts";

type Fetch = typeof fetch;
type EthereumEvidence = Parameters<typeof checkEthereumPayment>[0];
type CardanoEvidence = Parameters<typeof checkCardanoPayment>[0];

/** Fail closed on provider, protocol, or parsing errors. A missing transaction is pending. */
export async function verifyEthereumPayment(args: {
  rpcUrl: string;
  network: "mainnet" | "sepolia";
  txHash: string;
  tokenContract?: string;
  expected: PaymentExpectation;
  fetchImpl?: Fetch;
}): Promise<PaymentCheck> {
  if (!/^0x[0-9a-f]{64}$/i.test(args.txHash)) return "invalid";
  const fetchImpl = args.fetchImpl ?? fetch;
  let nextId = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const id = ++nextId;
    const res = await fetchImpl(args.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error("Ethereum provider unavailable");
    const body = await res.json();
    if (
      body?.jsonrpc !== "2.0" || body.id !== id || body.error ||
      !("result" in body)
    ) {
      throw new Error("invalid Ethereum provider response");
    }
    return body.result;
  }
  const chainId = await rpc("eth_chainId", []);
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
    throw new Error("invalid Ethereum provider response");
  }
  if (BigInt(chainId) !== (args.network === "sepolia" ? 11155111n : 1n)) {
    throw new Error("Ethereum provider is connected to the wrong network");
  }
  const [tx, receipt, latest] = await Promise.all([
    rpc("eth_getTransactionByHash", [args.txHash]),
    rpc("eth_getTransactionReceipt", [args.txHash]),
    rpc("eth_blockNumber", []),
  ]);
  if (typeof latest !== "string") {
    throw new Error("invalid Ethereum provider response");
  }
  if (tx === null || receipt === null) {
    return checkEthereumPayment({
      txHash: args.txHash,
      chainId,
      network: args.network,
      transaction: null,
      receipt: null,
      canonicalBlockHash: null,
      latestBlock: latest,
      tokenContract: args.tokenContract,
      expected: args.expected,
    });
  }
  if (
    typeof tx !== "object" || typeof receipt !== "object" || !receipt ||
    typeof (receipt as { blockNumber?: unknown }).blockNumber !== "string"
  ) {
    throw new Error("invalid Ethereum provider response");
  }
  const block = await rpc("eth_getBlockByNumber", [
    (receipt as { blockNumber: string }).blockNumber,
    false,
  ]);
  if (
    !block || typeof block !== "object" ||
    typeof (block as { hash?: unknown }).hash !== "string"
  ) {
    throw new Error("Ethereum canonical block unavailable");
  }
  return checkEthereumPayment({
    txHash: args.txHash,
    chainId,
    network: args.network,
    transaction: tx as EthereumEvidence["transaction"],
    receipt: receipt as EthereumEvidence["receipt"],
    canonicalBlockHash: (block as { hash: string }).hash,
    latestBlock: latest,
    tokenContract: args.tokenContract,
    expected: args.expected,
  });
}

/** Blockfrost access; the API key must never be returned to clients. */
export async function verifyCardanoPayment(args: {
  apiKey: string;
  network: "mainnet" | "preview";
  txHash: string;
  assetUnit: string;
  expected: PaymentExpectation;
  fetchImpl?: Fetch;
}): Promise<PaymentCheck> {
  if (!/^[0-9a-f]{64}$/i.test(args.txHash)) return "invalid";
  const fetchImpl = args.fetchImpl ?? fetch;
  async function get(path: string, allowMissing = false): Promise<unknown> {
    const res = await fetchImpl(
      `https://cardano-${
        args.network === "preview" ? "preview" : "mainnet"
      }.blockfrost.io/api/v0${path}`,
      {
        headers: { project_id: args.apiKey },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) throw new Error("Cardano provider unavailable");
    return await res.json();
  }
  const hash = args.txHash.toLowerCase();
  const tx = await get(`/txs/${hash}`, true);
  if (tx === null) return "pending";
  if (
    typeof tx !== "object" ||
    !Number.isSafeInteger((tx as { block_height?: unknown }).block_height)
  ) {
    throw new Error("invalid Cardano provider response");
  }
  const height = (tx as { block_height: number }).block_height;
  const [utxos, metadata, canonical, latest] = await Promise.all([
    get(`/txs/${hash}/utxos`),
    get(`/txs/${hash}/metadata?count=100`),
    get(`/blocks/${height}`),
    get("/blocks/latest"),
  ]);
  if (
    !utxos || typeof utxos !== "object" ||
    !Array.isArray((utxos as { outputs?: unknown }).outputs) ||
    !Array.isArray(metadata) || metadata.length >= 100 || !canonical ||
    typeof canonical !== "object" ||
    typeof (canonical as { hash?: unknown }).hash !== "string" || !latest ||
    typeof latest !== "object" ||
    !Number.isSafeInteger((latest as { height?: unknown }).height)
  ) {
    throw new Error("invalid Cardano provider response");
  }
  return checkCardanoPayment({
    txHash: hash,
    transaction: tx as CardanoEvidence["transaction"],
    outputs: (utxos as { outputs: CardanoEvidence["outputs"] }).outputs,
    metadata: metadata as CardanoEvidence["metadata"],
    canonicalBlockHash: (canonical as { hash: string }).hash,
    latestHeight: (latest as { height: number }).height,
    assetUnit: args.assetUnit,
    expected: args.expected,
  });
}
