import { KeyedQueue } from "../../common/KeyedQueue.ts";
import type { DatabaseAdapter } from "../db/adapter.ts";

const RATE_CACHE_MS = 2 * 60 * 60 * 1000;
const refreshQueue = new KeyedQueue();

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
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
      {
        jsonrpc: "2.0", id: 2, method: "eth_call",
        params: [{ to: feed.proxy, data: LATEST_ROUND_DATA }, "latest"],
      },
    ]),
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("exchange rate unavailable");

  const body = await response.json();
  if (
    !Array.isArray(body) || body.length !== 2 ||
    body.some((item) => item?.jsonrpc !== "2.0" || item.error || !("result" in item))
  ) throw new Error("invalid exchange rate response");

  const chainId: unknown = body.find((item) => item.id === 1)?.result;
  const result: unknown = body.find((item) => item.id === 2)?.result;
  if (
    typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId) ||
    BigInt(chainId) !== feed.chainId
  ) throw new Error("invalid or stale exchange rate");
  return roundToDecimal(result, nowMs, feed.maxAgeMs);
}

/** Claim one refresh per feed and interval across processes sharing the order database. */
export function getCachedUsdRate(
  db: DatabaseAdapter,
  asset: keyof typeof FEEDS,
  apiKey: string,
  now = Date.now,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return refreshQueue.run(asset, async () => {
    const readRate = async (time: number) => {
      const rows = await db.query<[string]>(
        "SELECT usd_rate FROM mail_payment_rates WHERE asset = ? AND cached_at > ?",
        [asset, time - RATE_CACHE_MS],
      );
      return rows[0]?.[0];
    };

    const time = now();
    const cached = await readRate(time);
    if (cached) return cached;

    const expiredAt = time - RATE_CACHE_MS;
    const claimed = await db.query<[string]>(
      `INSERT INTO mail_payment_rates (asset, last_attempt_at)
       VALUES (?, ?)
       ON CONFLICT (asset) DO UPDATE SET last_attempt_at = excluded.last_attempt_at
       WHERE mail_payment_rates.last_attempt_at <= ?
         AND (mail_payment_rates.cached_at IS NULL OR mail_payment_rates.cached_at <= ?)
       RETURNING asset`,
      [asset, time, expiredAt, expiredAt],
    );
    if (!claimed.length) {
      const refreshed = await readRate(now());
      if (refreshed) return refreshed;
      throw new Error("exchange rate unavailable");
    }

    const rate = await fetchUsdRate(asset, apiKey, time, fetchImpl);
    await db.query(
      "UPDATE mail_payment_rates SET usd_rate = ?, cached_at = ? WHERE asset = ? AND last_attempt_at = ?",
      [rate, now(), asset, time],
    );
    return rate;
  });
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
