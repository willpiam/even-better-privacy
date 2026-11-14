export type PaymentNetwork =
  | "ethereum-mainnet"
  | "ethereum-sepolia"
  | "cardano-mainnet"
  | "cardano-preview";
export type ConfiguredAsset = {
  network: PaymentNetwork;
  symbol: string;
  recipient: string;
  unit: string;
  decimals: number;
};
export type PaymentConfig = {
  prices: Record<string, number>;
  assets: ConfiguredAsset[];
  ethereumRpcUrl: string;
  blockfrostKey: string;
  coinGeckoKey: string;
  ethereumConfirmations: number;
  cardanoConfirmations: number;
};
export function paymentConfigMatchesDomain(
  domain: string,
  config: PaymentConfig,
): boolean {
  return domain === "pqpost.com" &&
      config.assets.every((asset) => asset.network.endsWith("-mainnet")) ||
    domain === "test.pqpost.com" &&
      config.assets.every((asset) => !asset.network.endsWith("-mainnet"));
}
const SYMBOLS: Record<string, string[]> = {
  ethereum: ["ETH", "USDC", "USDT"],
  cardano: ["ADA", "USDM", "USDA", "USDCx", "DJED", "iUSD"],
};

type PaymentPrefix = "MAIL_PAYMENT" | "MAIL_TEST_PAYMENT";

function paymentEnv(prefix: PaymentPrefix, name: string, fallback = false): string | undefined {
  const value = Deno.env.get(`${prefix}_${name}`);
  if (value !== undefined && value.trim() !== "") return value;
  if (!fallback || prefix === "MAIL_PAYMENT") return undefined;
  const shared = Deno.env.get(`MAIL_PAYMENT_${name}`);
  return shared !== undefined && shared.trim() !== "" ? shared : undefined;
}

/** Missing or malformed configuration disables payment rather than guessing. */
function readPrefixedPaymentConfig(prefix: PaymentPrefix): PaymentConfig | null {
  if (paymentEnv(prefix, "ENABLED") !== "true") return null;
  try {
    const prices = JSON.parse(paymentEnv(prefix, "PRICES_CENTS", true) ?? "null");
    const assets = JSON.parse(paymentEnv(prefix, "ASSETS") ?? "null") as unknown;
    const ethereumRpcUrl = (paymentEnv(prefix, "ETH_RPC_URL") ?? "").trim();
    const blockfrostKey = (paymentEnv(prefix, "BLOCKFROST_KEY") ?? "").trim();
    const coinGeckoKey = (paymentEnv(prefix, "COINGECKO_KEY", true) ?? "").trim();
    const ethereumConfirmations = Number(paymentEnv(prefix, "ETH_CONFIRMATIONS", true) ?? "5");
    const cardanoConfirmations = Number(paymentEnv(prefix, "CARDANO_CONFIRMATIONS", true) ?? "2");
    if (
      !prices || typeof prices !== "object" || !Array.isArray(assets) ||
      assets.length === 0 ||
      !ethereumRpcUrl || !blockfrostKey || !coinGeckoKey
    ) return null;
    if (
      ![ethereumConfirmations, cardanoConfirmations].every((value) =>
        Number.isSafeInteger(value) && value > 0 && value <= 1000
      )
    ) return null;
    if (new URL(ethereumRpcUrl).protocol !== "https:") return null;
    for (let length = 3; length <= 8; length++) {
      if (!Number.isSafeInteger(prices[length]) || prices[length] <= 0) {
        return null;
      }
    }
    for (let length = 3; length < 8; length++) {
      if (prices[length] <= prices[length + 1]) return null;
    }
    const seen = new Set<string>();
    for (const asset of assets) {
      if (
        !asset || typeof asset !== "object" ||
        typeof asset.network !== "string" ||
        typeof asset.symbol !== "string" ||
        typeof asset.recipient !== "string" ||
        typeof asset.unit !== "string" || !Number.isInteger(asset.decimals) ||
        asset.decimals < 0 || asset.decimals > 30
      ) return null;
      const [chain, environment, extra] = asset.network.split("-");
      if (
        extra || !SYMBOLS[chain]?.includes(asset.symbol) ||
        !(chain === "ethereum" &&
            ["mainnet", "sepolia"].includes(environment) ||
          chain === "cardano" && ["mainnet", "preview"].includes(environment))
      ) return null;
      const key = `${asset.network}:${asset.symbol}`;
      if (seen.has(key)) return null;
      seen.add(key);
      if (chain === "ethereum") {
        if (
          !/^0x[0-9a-f]{40}$/i.test(asset.recipient) ||
          (asset.symbol === "ETH"
            ? asset.unit !== "native" || asset.decimals !== 18
            : !/^0x[0-9a-f]{40}$/i.test(asset.unit))
        ) return null;
      } else {
        if (
          !(environment === "mainnet"
            ? asset.recipient.startsWith("addr1")
            : asset.recipient.startsWith("addr_test1")) ||
          (asset.symbol === "ADA"
            ? asset.unit !== "lovelace" || asset.decimals !== 6
            : !/^[0-9a-f]{56}([0-9a-f]{2}){0,32}$/.test(asset.unit))
        ) return null;
      }
    }
    // Testnet and mainnet must use separate deployments, credentials and data.
    const environments = new Set(
      assets.map((a) => a.network.endsWith("mainnet") ? "mainnet" : "testnet"),
    );
    if (environments.size !== 1) return null;
    return {
      prices,
      assets: assets as ConfiguredAsset[],
      ethereumRpcUrl,
      blockfrostKey,
      coinGeckoKey,
      ethereumConfirmations,
      cardanoConfirmations,
    };
  } catch {
    return null;
  }
}

export function readPaymentConfig(): PaymentConfig | null {
  return readPrefixedPaymentConfig("MAIL_PAYMENT");
}

/** Test-network assets for test.pqpost.com on a server whose primary domain is pqpost.com. */
export function readTestPaymentConfig(): PaymentConfig | null {
  return readPrefixedPaymentConfig("MAIL_TEST_PAYMENT");
}
