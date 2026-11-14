import { assertEquals, assertThrows } from "jsr:@std/assert@^1.0.6";
import { checkCardanoPayment, checkEthereumPayment } from "./verification.ts";
import { quoteAtomicUnits } from "./quote.ts";

Deno.test("quotes use exact arithmetic and round up", () => {
  assertEquals(quoteAtomicUnits(100, "1", 6), 1_000_000n);
  assertEquals(quoteAtomicUnits(100, "3", 6), 333_334n);
  assertEquals(quoteAtomicUnits(1234, "0.5", 6), 24_680_000n);
  for (const rate of ["0", "-1", "1e3", "NaN", "0.0000000000000000001"]) {
    assertThrows(() => quoteAtomicUnits(100, rate, 6));
  }
});

Deno.test("Ethereum payments bind recipient, message, canonical block and confirmations", () => {
  const hash = `0x${"1".repeat(64)}`;
  const blockHash = `0x${"2".repeat(64)}`;
  const recipient = `0x${"3".repeat(40)}`;
  const expected = {
    recipient,
    amount: 10n,
    message: "order-1",
    confirmations: 5,
  };
  const tx = {
    hash,
    to: recipient,
    value: "0xa",
    input: "0x6f726465722d31",
    blockHash,
    blockNumber: "0xa",
  };
  const receipt = {
    transactionHash: hash,
    blockHash,
    blockNumber: "0xa",
    status: "0x1",
    logs: [],
  };
  const payment = {
    txHash: hash,
    chainId: "0xaa36a7",
    network: "sepolia" as const,
    transaction: tx,
    receipt,
    canonicalBlockHash: blockHash,
    latestBlock: "0xe",
    expected,
  };
  assertEquals(checkEthereumPayment(payment), "confirmed");
  assertEquals(
    checkEthereumPayment({ ...payment, latestBlock: "0xd" }),
    "pending",
  );
  assertEquals(checkEthereumPayment({ ...payment, chainId: "0x5" }), "invalid");
  assertEquals(
    checkEthereumPayment({ ...payment, chainId: "0x1" }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({
      ...payment,
      chainId: "0xaa36a7",
      network: "sepolia",
    }),
    "confirmed",
  );
  assertEquals(
    checkEthereumPayment({ ...payment, network: "mainnet" }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({ ...payment, canonicalBlockHash: hash }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({ ...payment, transaction: { ...tx, value: "0x9" } }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({ ...payment, transaction: { ...tx, input: "0x" } }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({
      ...payment,
      receipt: { ...receipt, status: "0x0" },
    }),
    "invalid",
  );
});

Deno.test("ERC-20 requires both exact calldata and matching transfer event", () => {
  const hash = `0x${"1".repeat(64)}`;
  const blockHash = `0x${"2".repeat(64)}`;
  const recipient = `0x${"3".repeat(40)}`;
  const contract = `0x${"4".repeat(40)}`;
  const topic = `0x${recipient.slice(2).padStart(64, "0")}`;
  const event = {
    address: contract,
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${"0".repeat(64)}`,
      topic,
    ],
    data: `0x${"a".padStart(64, "0")}`,
  };
  const transaction = {
    hash,
    to: contract,
    value: "0x0",
    input: `0xa9059cbb${recipient.slice(2).padStart(64, "0")}${
      "a".padStart(64, "0")
    }6f726465722d31`,
    blockHash,
    blockNumber: "0xa",
  };
  const receipt = {
    transactionHash: hash,
    blockHash,
    blockNumber: "0xa",
    status: "0x1",
    logs: [event],
  };
  const payment = {
    txHash: hash,
    chainId: "0xaa36a7",
    network: "sepolia" as const,
    transaction,
    receipt,
    canonicalBlockHash: blockHash,
    latestBlock: "0xe",
    tokenContract: contract,
    expected: { recipient, amount: 10n, message: "order-1", confirmations: 5 },
  };
  assertEquals(checkEthereumPayment(payment), "confirmed");
  assertEquals(
    checkEthereumPayment({ ...payment, receipt: { ...receipt, logs: [] } }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({
      ...payment,
      receipt: {
        ...receipt,
        logs: [{ ...event, data: `0x${"9".padStart(64, "0")}` }],
      },
    }),
    "invalid",
  );
  assertEquals(
    checkEthereumPayment({
      ...payment,
      transaction: { ...transaction, input: `${transaction.input}00` },
    }),
    "invalid",
  );
});

Deno.test("Cardano checks CIP-20, outputs, asset, canonical block and depth", () => {
  const hash = "1".repeat(64);
  const block = "2".repeat(64);
  const expected = {
    recipient: "addr_test1recipient",
    amount: 10n,
    message: "order-1",
    confirmations: 2,
  };
  const payment = {
    txHash: hash,
    transaction: { hash, block, block_height: 10 },
    outputs: [{
      address: expected.recipient,
      amount: [{ unit: "lovelace", quantity: "10" }],
    }],
    metadata: [{ label: "674", json_metadata: { msg: ["order-1"] } }],
    canonicalBlockHash: block,
    latestHeight: 11,
    assetUnit: "lovelace",
    expected,
  };
  assertEquals(checkCardanoPayment(payment), "confirmed");
  assertEquals(
    checkCardanoPayment({ ...payment, latestHeight: 10 }),
    "pending",
  );
  assertEquals(checkCardanoPayment({ ...payment, metadata: [] }), "invalid");
  assertEquals(
    checkCardanoPayment({ ...payment, assetUnit: "a".repeat(56) }),
    "invalid",
  );
  assertEquals(
    checkCardanoPayment({ ...payment, canonicalBlockHash: hash }),
    "invalid",
  );
  assertEquals(
    checkCardanoPayment({
      ...payment,
      outputs: [{
        address: "elsewhere",
        amount: [{ unit: "lovelace", quantity: "10" }],
      }],
    }),
    "invalid",
  );
});

Deno.test("provider adapters fail closed and treat unseen transactions as pending", async () => {
  const { verifyEthereumPayment, verifyCardanoPayment } = await import(
    "./providers.ts"
  );
  const { assertRejects } = await import("jsr:@std/assert@^1.0.6");
  const expected = {
    recipient: `0x${"3".repeat(40)}`,
    amount: 1n,
    message: "order-1",
    confirmations: 5,
  };
  const pendingRpc: typeof fetch = (_url, init) => {
    const request = JSON.parse(
      String((init as { body?: unknown } | undefined)?.body),
    );
    const result = request.method === "eth_chainId"
      ? "0xaa36a7"
      : request.method === "eth_blockNumber"
      ? "0x10"
      : null;
    return Promise.resolve(
      Response.json({ jsonrpc: "2.0", id: request.id, result }),
    );
  };
  assertEquals(
    await verifyEthereumPayment({
      rpcUrl: "https://rpc.example",
      network: "sepolia",
      txHash: `0x${"1".repeat(64)}`,
      expected,
      fetchImpl: pendingRpc,
    }),
    "pending",
  );
  const unavailable: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 503 }));
  const methods: string[] = [];
  const wrongNetwork: typeof fetch = (_url, init) => {
    const request = JSON.parse(
      String((init as { body?: unknown } | undefined)?.body),
    );
    methods.push(request.method);
    return Promise.resolve(
      Response.json({ jsonrpc: "2.0", id: request.id, result: "0x1" }),
    );
  };
  await assertRejects(() =>
    verifyEthereumPayment({
      rpcUrl: "https://rpc.example",
      network: "sepolia",
      txHash: `0x${"1".repeat(64)}`,
      expected,
      fetchImpl: wrongNetwork,
    })
  );
  assertEquals(methods, ["eth_chainId"]);
  await assertRejects(() =>
    verifyEthereumPayment({
      rpcUrl: "https://rpc.example",
      network: "sepolia",
      txHash: `0x${"1".repeat(64)}`,
      expected,
      fetchImpl: unavailable,
    })
  );
  const missing: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 404 }));
  assertEquals(
    await verifyCardanoPayment({
      apiKey: "test",
      network: "preview",
      txHash: "1".repeat(64),
      assetUnit: "lovelace",
      expected: { ...expected, recipient: "addr_test1test" },
      fetchImpl: missing,
    }),
    "pending",
  );
  await assertRejects(() =>
    verifyCardanoPayment({
      apiKey: "test",
      network: "preview",
      txHash: "1".repeat(64),
      assetUnit: "lovelace",
      expected: { ...expected, recipient: "addr_test1test" },
      fetchImpl: unavailable,
    })
  );
  let requestedHost = "";
  const testnetMissing: typeof fetch = (url) => {
    requestedHost = new URL(String(url)).hostname;
    return Promise.resolve(new Response(null, { status: 404 }));
  };
  assertEquals(
    await verifyCardanoPayment({
      apiKey: "test",
      network: "preview",
      txHash: "1".repeat(64),
      assetUnit: "lovelace",
      expected: { ...expected, recipient: "addr_test1" },
      fetchImpl: testnetMissing,
    }),
    "pending",
  );
  assertEquals(requestedHost, "cardano-preview.blockfrost.io");
});
