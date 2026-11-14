import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { readPaymentConfig, readTestPaymentConfig } from "../payments/config.ts";
import {
  mailModeFromRequest,
  mailSettingsForMode,
  paymentConfigForSettings,
} from "./mail-signup.ts";

const PRICES = JSON.stringify({ 3: 600, 4: 500, 5: 400, 6: 300, 7: 200, 8: 100 });
const TEST_ASSET = {
  network: "ethereum-sepolia",
  symbol: "ETH",
  recipient: `0x${"1".repeat(40)}`,
  unit: "native",
  decimals: 18,
};

Deno.test("test mode on the production server serves only the test domain", () => {
  const keys = [
    "MAIL_SIGNUP_ENABLED",
    "MAIL_DOMAIN",
    "MAIL_HOST",
    "MAIL_PAYMENT_ENABLED",
    "MAIL_PAYMENT_PRICES_CENTS",
    "MAIL_PAYMENT_ASSETS",
    "MAIL_PAYMENT_ETH_RPC_URL",
    "MAIL_PAYMENT_BLOCKFROST_KEY",
    "MAIL_PAYMENT_COINGECKO_KEY",
    "MAIL_TEST_PAYMENT_ENABLED",
    "MAIL_TEST_PAYMENT_ASSETS",
    "MAIL_TEST_PAYMENT_ETH_RPC_URL",
    "MAIL_TEST_PAYMENT_BLOCKFROST_KEY",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, Deno.env.get(key)]));
  try {
    Deno.env.set("MAIL_SIGNUP_ENABLED", "true");
    Deno.env.set("MAIL_DOMAIN", "pqpost.com");
    Deno.env.set("MAIL_HOST", "mail.pqpost.com");
    Deno.env.set("MAIL_PAYMENT_ENABLED", "false");
    Deno.env.set("MAIL_PAYMENT_PRICES_CENTS", PRICES);
    Deno.env.set("MAIL_PAYMENT_COINGECKO_KEY", "demo");
    Deno.env.set("MAIL_TEST_PAYMENT_ENABLED", "true");
    Deno.env.set("MAIL_TEST_PAYMENT_ASSETS", JSON.stringify([TEST_ASSET]));
    Deno.env.set("MAIL_TEST_PAYMENT_ETH_RPC_URL", "https://rpc.sepolia.example");
    Deno.env.set("MAIL_TEST_PAYMENT_BLOCKFROST_KEY", "preview-key");

    assertEquals(mailSettingsForMode("production").domain, "pqpost.com");
    assertEquals(mailSettingsForMode("test").domain, "test.pqpost.com");
    assertEquals(mailSettingsForMode("test").host, "mail.pqpost.com");
    assertEquals(readPaymentConfig(), null);
    assertEquals(readTestPaymentConfig()?.assets[0].network, "ethereum-sepolia");
    assertEquals(
      paymentConfigForSettings(mailSettingsForMode("production")),
      null,
    );
    assertEquals(
      paymentConfigForSettings(mailSettingsForMode("test"))?.assets[0].symbol,
      "ETH",
    );

    Deno.env.set("MAIL_TEST_PAYMENT_ASSETS", JSON.stringify([{
      ...TEST_ASSET,
      network: "ethereum-mainnet",
    }]));
    assertEquals(readTestPaymentConfig()?.assets[0].network, "ethereum-mainnet");
    assertEquals(paymentConfigForSettings(mailSettingsForMode("test")), null);

    const request = new Request("https://ebp-cqyo.onrender.com/api/v1/mail/signup/config", {
      headers: { "x-ebp-mail-mode": "test" },
    });
    assertEquals(mailModeFromRequest(request), "test");
    assertEquals(
      mailModeFromRequest(new Request("https://ebp-cqyo.onrender.com/api/v1/mail/signup/config?mode=test")),
      "test",
    );
    assertEquals(
      mailModeFromRequest(new Request("https://ebp-cqyo.onrender.com/api/v1/mail/signup/config")),
      "production",
    );
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
