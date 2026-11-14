import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { paymentConfigMatchesDomain, readPaymentConfig } from "./config.ts";

Deno.test("payment configuration is opt-in, complete and isolates testnets", () => {
  const env: Record<string, string> = {
    MAIL_PAYMENT_ENABLED: "true",
    MAIL_PAYMENT_PRICES_CENTS: JSON.stringify({
      3: 600,
      4: 500,
      5: 400,
      6: 300,
      7: 200,
      8: 100,
    }),
    MAIL_PAYMENT_ASSETS: JSON.stringify([{
      network: "ethereum-sepolia",
      symbol: "ETH",
      recipient: `0x${"1".repeat(40)}`,
      unit: "native",
      decimals: 18,
    }]),
    MAIL_PAYMENT_ETH_RPC_URL: "https://rpc.example",
    MAIL_PAYMENT_BLOCKFROST_KEY: "test",
    MAIL_PAYMENT_COINGECKO_KEY: "test",
    MAIL_PAYMENT_ETH_CONFIRMATIONS: "5",
    MAIL_PAYMENT_CARDANO_CONFIRMATIONS: "2",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  try {
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    assertEquals(readPaymentConfig()?.assets[0].network, "ethereum-sepolia");
    assertEquals(readPaymentConfig()?.ethereumConfirmations, 5);
    Deno.env.set("MAIL_PAYMENT_ETH_CONFIRMATIONS", "0");
    assertEquals(readPaymentConfig(), null);
    Deno.env.set("MAIL_PAYMENT_ETH_CONFIRMATIONS", "5");
    assertEquals(
      paymentConfigMatchesDomain("pqpost.com", readPaymentConfig()!),
      false,
    );
    assertEquals(
      paymentConfigMatchesDomain("test.pqpost.com", readPaymentConfig()!),
      true,
    );
    Deno.env.set(
      "MAIL_PAYMENT_ASSETS",
      JSON.stringify([{
        network: "cardano-preview",
        symbol: "ADA",
        recipient: "addr_test1example",
        unit: "lovelace",
        decimals: 6,
      }]),
    );
    assertEquals(readPaymentConfig()?.assets[0].network, "cardano-preview");
    Deno.env.set(
      "MAIL_PAYMENT_ASSETS",
      JSON.stringify([{
        network: "cardano-preprod",
        symbol: "ADA",
        recipient: "addr_test1example",
        unit: "lovelace",
        decimals: 6,
      }]),
    );
    assertEquals(readPaymentConfig(), null);
    Deno.env.set("MAIL_PAYMENT_ASSETS", env.MAIL_PAYMENT_ASSETS);
    const mixed = JSON.parse(env.MAIL_PAYMENT_ASSETS);
    mixed.push({ ...mixed[0], network: "ethereum-mainnet" });
    Deno.env.set("MAIL_PAYMENT_ASSETS", JSON.stringify(mixed));
    assertEquals(readPaymentConfig(), null);
    Deno.env.set("MAIL_PAYMENT_ASSETS", env.MAIL_PAYMENT_ASSETS);
    Deno.env.set(
      "MAIL_PAYMENT_PRICES_CENTS",
      JSON.stringify({ 3: 100, 4: 200, 5: 300, 6: 400, 7: 500, 8: 600 }),
    );
    assertEquals(readPaymentConfig(), null);
    Deno.env.set("MAIL_PAYMENT_PRICES_CENTS", JSON.stringify({ 3: 100 }));
    assertEquals(readPaymentConfig(), null);
    Deno.env.set("MAIL_PAYMENT_ENABLED", "false");
    assertEquals(readPaymentConfig(), null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
