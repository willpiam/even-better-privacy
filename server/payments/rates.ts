/** Fetch fresh ADA and ETH prices. Never use a stale or missing rate for a quote. */
export async function fetchUsdRate(
  asset: "ADA" | "ETH",
  apiKey: string,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const id = asset === "ADA" ? "cardano" : "ethereum";
  const url =
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_last_updated_at=true&precision=full`;
  const response = await fetchImpl(url, {
    headers: { "x-cg-demo-api-key": apiKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("exchange rate unavailable");
  const data = await response.json();
  const entry = data?.[id];
  const rate = entry?.usd;
  const updatedAt = entry?.last_updated_at;
  if (
    typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 ||
    rate >= 1e12 ||
    !Number.isSafeInteger(updatedAt) || updatedAt * 1000 > nowMs + 30_000 ||
    nowMs - updatedAt * 1000 > 120_000
  ) throw new Error("invalid or stale exchange rate");
  const decimal = rate.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  if (decimal === "0") throw new Error("invalid exchange rate");
  return decimal;
}
