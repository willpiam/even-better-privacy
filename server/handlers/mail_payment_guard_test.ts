import { assertEquals } from "@std/assert";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import { handleMailUsernameAvailable, setStalwartClientForTests } from "./mail-signup.ts";
import { handlePaymentCreate } from "./mail-payment.ts";
import { StalwartClient } from "../stalwart.ts";

const PRICES = JSON.stringify({ 3: 600, 4: 500, 5: 400, 6: 300, 7: 200, 8: 100 });

Deno.test("short production names stay blocked and mainnet payment orders are rejected", async () => {
  const keys = [
    "MAIL_SIGNUP_ENABLED",
    "MAIL_DOMAIN",
    "MAIL_HOST",
    "MAIL_PAYMENT_ENABLED",
    "MAIL_PAYMENT_PRICES_CENTS",
    "MAIL_PAYMENT_ASSETS",
    "MAIL_PAYMENT_ETH_RPC_URL",
    "MAIL_PAYMENT_BLOCKFROST_KEY",
    "ETHEREUM_ALCHEMY_API_KEY",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, Deno.env.get(key)]));
  const db = new SqliteDatabaseAdapter(":memory:");
  try {
    Deno.env.set("MAIL_SIGNUP_ENABLED", "true");
    Deno.env.set("MAIL_DOMAIN", "pqpost.com");
    Deno.env.set("MAIL_HOST", "mail.pqpost.com");
    Deno.env.set("MAIL_PAYMENT_ENABLED", "true");
    Deno.env.set("MAIL_PAYMENT_PRICES_CENTS", PRICES);
    Deno.env.set("MAIL_PAYMENT_ASSETS", JSON.stringify([{
      network: "ethereum-mainnet",
      symbol: "ETH",
      recipient: `0x${"1".repeat(40)}`,
      unit: "native",
      decimals: 18,
    }]));
    Deno.env.set("MAIL_PAYMENT_ETH_RPC_URL", "https://rpc.example");
    Deno.env.set("MAIL_PAYMENT_BLOCKFROST_KEY", "mainnet-key");
    Deno.env.set("ETHEREUM_ALCHEMY_API_KEY", "demo");
    setStalwartClientForTests(new StalwartClient({
      baseUrl: "https://stalwart.test",
      token: "test",
      domainId: null,
    }));

    const availability = await handleMailUsernameAvailable(
      new URL("https://ebp-cqyo.onrender.com/api/v1/mail/username-available?u=abc"),
      db,
    );
    const body = await availability.json();
    assertEquals(body.available, false);
    assertEquals(body.purchasable, undefined);
    assertEquals(body.reason.includes("not available"), true);

    const created = await handlePaymentCreate(new Request("https://ebp-cqyo.onrender.com/api/v1/mail/payment/order", {
      method: "POST",
      body: "{}",
    }), db);
    assertEquals(created.status, 400);

    Deno.env.set("MAIL_DOMAIN", "test.pqpost.com");
    Deno.env.set("MAIL_PAYMENT_ASSETS", JSON.stringify([{
      network: "ethereum-sepolia",
      symbol: "ETH",
      recipient: `0x${"2".repeat(40)}`,
      unit: "native",
      decimals: 18,
    }]));
    const mainnet = await handlePaymentCreate(new Request("https://ebp-cqyo.onrender.com/api/v1/mail/payment/order", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fingerprint: "not-a-fingerprint",
        username: "abc",
        network: "ethereum-mainnet",
        asset: "ETH",
        proof: "aa",
      }),
    }), db);
    assertEquals(mainnet.status, 400);
    assertEquals((await mainnet.json()).error, "unsupported payment asset");
  } finally {
    setStalwartClientForTests(null);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
