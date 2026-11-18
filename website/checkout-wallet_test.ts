import { assertEquals, assertThrows } from "@std/assert";
import {
  messageInput,
  quantityHex,
  sepoliaPayment,
  walletPayKind,
} from "./checkout-wallet.js";

const quoted = {
  status: "quoted",
  expiresAt: Date.now() + 60_000,
  email: "abc@test.pqpost.com",
  network: "ethereum-sepolia",
  asset: "ETH",
  assetUnit: "native",
  recipient: `0x${"ab".repeat(20)}`,
  amountAtomic: "530494632857512",
  message: "pqpost:b34af21f-ccfd-404b-84cc-865afdad3100",
};

Deno.test("wallet payment is limited to quoted test addresses", () => {
  assertEquals(walletPayKind(quoted), "ethereum");
  assertEquals(
    walletPayKind({
      ...quoted,
      network: "cardano-preview",
      asset: "ADA",
      assetUnit: "lovelace",
      recipient:
        "addr_test1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    }),
    "cardano",
  );
  assertEquals(walletPayKind({ ...quoted, email: "abc@pqpost.com" }), null);
  assertEquals(walletPayKind({ ...quoted, network: "ethereum-mainnet" }), null);
  assertEquals(
    walletPayKind({ ...quoted, assetUnit: "0x" + "1".repeat(40) }),
    null,
  );
  assertEquals(walletPayKind({ ...quoted, status: "pending" }), null);
});

Deno.test("Sepolia payment carries the order message as transaction input", () => {
  const from = `0x${"12".repeat(20)}`;
  assertEquals(sepoliaPayment(quoted, from), {
    from,
    to: quoted.recipient,
    value: quantityHex(quoted.amountAtomic),
    data: messageInput(quoted.message),
  });
  assertEquals(quantityHex("0"), "0x0");
  assertEquals(messageInput("A").length, 4);
  assertThrows(() =>
    sepoliaPayment({ ...quoted, email: "abc@pqpost.com" }, from)
  );
});

Deno.test("Sepolia stablecoin wallet payment sends zero ETH and the quoted transfer", () => {
  const from = `0x${"12".repeat(20)}`;
  const assetUnit = `0x${"34".repeat(20)}`;
  assertEquals(
    sepoliaPayment(
      { ...quoted, asset: "tUSDC", assetUnit, amountAtomic: "42" },
      from,
    ),
    {
      from,
      to: assetUnit,
      value: "0x0",
      data: `0xa9059cbb${quoted.recipient.slice(2).padStart(64, "0")}${
        "2a".padStart(64, "0")
      }${messageInput(quoted.message).slice(2)}`,
    },
  );
});
