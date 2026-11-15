/** Chainlink USD quotes. A stale or missing round is never used. */

const LATEST_ROUND_DATA = "0xfeaf968c";
const DECIMALS = 8;
const PRICE_SCALE = 10n ** BigInt(DECIMALS);
/** One trillion dollars, in the feed's 8-decimal fixed point. */
const MAX_ANSWER = 10n ** 20n;

const FEEDS = {
  ETH: {
    host: "eth-mainnet.g.alchemy.com",
    chainId: 1n,
    proxy: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    maxAgeMs: 70 * 60 * 1000,
  },
  ADA: {
    host: "polygon-mainnet.g.alchemy.com",
    chainId: 137n,
    proxy: "0x882554df528115a743c4537828DA8D5B58e52544",
    maxAgeMs: 5 * 60 * 1000,
  },
} as const;

/**
 * Read a fresh ETH or ADA price in USD. `apiKey` is an Alchemy key. ETH/USD
 * comes from Ethereum mainnet and ADA/USD from Polygon mainnet.
 */
export async function fetchUsdRate(
  asset: "ADA" | "ETH",
  apiKey: string,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(apiKey)) {
    throw new Error("exchange rate unavailable");
  }
  const feed = FEEDS[asset];
  const url = `https://${feed.host}/v2/${apiKey}`;
  let nextId = 0;
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const id = ++nextId;
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("exchange rate unavailable");
    const body = await response.json();
    if (
      body?.jsonrpc !== "2.0" || body.id !== id || body.error ||
      !("result" in body)
    ) {
      throw new Error("exchange rate unavailable");
    }
    return body.result;
  }

  const chainId = await rpc("eth_chainId", []);
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)) {
    throw new Error("invalid or stale exchange rate");
  }
  if (BigInt(chainId) !== feed.chainId) {
    throw new Error("invalid or stale exchange rate");
  }
  const result = await rpc("eth_call", [
    { to: feed.proxy, data: LATEST_ROUND_DATA },
    "latest",
  ]);
  return roundToDecimal(result, nowMs, feed.maxAgeMs);
}

function roundToDecimal(result: unknown, nowMs: number, maxAgeMs: number): string {
  if (typeof result !== "string" || !/^0x[0-9a-f]{320}$/i.test(result)) {
    throw new Error("invalid or stale exchange rate");
  }
  const words = result.slice(2).match(/.{64}/g);
  if (!words || words.length !== 5) throw new Error("invalid or stale exchange rate");
  const roundId = BigInt(`0x${words[0]}`);
  const answer = BigInt(`0x${words[1]}`);
  const updatedAt = BigInt(`0x${words[3]}`);
  const answeredInRound = BigInt(`0x${words[4]}`);
  const updatedMs = updatedAt * 1000n;
  const now = BigInt(nowMs);
  if (
    answer <= 0n || answer >= 1n << 255n || answer >= MAX_ANSWER ||
    answeredInRound < roundId ||
    updatedMs > now + 30_000n || now - updatedMs > BigInt(maxAgeMs)
  ) {
    throw new Error("invalid or stale exchange rate");
  }
  const whole = answer / PRICE_SCALE;
  const fraction = (answer % PRICE_SCALE).toString().padStart(DECIMALS, "0")
    .replace(/0+$/, "");
  const decimal = fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(decimal) || decimal === "0") {
    throw new Error("invalid or stale exchange rate");
  }
  return decimal;
}
