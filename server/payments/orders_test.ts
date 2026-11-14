import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import {
  confirmPaymentOrder,
  expirePaymentOrders,
  getPaymentOrder,
  type PaymentOrder,
  reservePaymentOrder,
  submitPaymentTransaction,
} from "./orders.ts";

Deno.test({
  name:
    "payment reservations, expiry and transaction claims are atomic and durable",
  sanitizeResources: false,
  async fn() {
    const db = new SqliteDatabaseAdapter(":memory:");
    try {
      for (const fingerprint of ["one", "two", "three"]) {
        await db.query(
          `INSERT INTO identities (fingerprint, signing_key_type, encryption_key_type, signing_key, encryption_key, created_at) VALUES (?, 'dilithium', 'kyber', 'key', 'key', 0)`,
          [fingerprint],
        );
      }
      const base: PaymentOrder = {
        orderId: "order1",
        username: "alice",
        domain: "pqpost.com",
        fingerprint: "one",
        proofNonce: 1,
        asset: "ETH",
        network: "ethereum-sepolia",
        recipient: "recipient",
        assetUnit: "native",
        usdCents: 100,
        amountAtomic: "500000000000000",
        decimals: 18,
        usdPerToken: "2000",
        confirmations: 5,
        message: "order1",
        createdAt: 100,
        expiresAt: 200,
        graceUntil: 300,
      };
      assertEquals(await reservePaymentOrder(db, base, 100), true);
      assertEquals(
        await reservePaymentOrder(db, {
          ...base,
          orderId: "order2",
          fingerprint: "two",
        }, 100),
        false,
      );
      assertEquals(
        await reservePaymentOrder(db, {
          ...base,
          orderId: "order2",
          username: "other",
        }, 100),
        false,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order1",
          "two",
          "a".repeat(64),
          150,
        ),
        false,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order1",
          "one",
          `0x${"a".repeat(64)}`,
          150,
        ),
        true,
      );
      assertEquals(
        (await getPaymentOrder(db, "order1"))?.transactionId,
        "a".repeat(64),
      );
      const another = {
        ...base,
        orderId: "order2",
        username: "other",
        fingerprint: "two",
      };
      assertEquals(await reservePaymentOrder(db, another, 100), true);
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order2",
          "two",
          "a".repeat(64),
          150,
        ),
        false,
      );
      assertEquals(
        await confirmPaymentOrder(db, "order1", "a".repeat(64), 250),
        true,
      );
      await expirePaymentOrders(db, 300);
      assertEquals((await getPaymentOrder(db, "order1"))?.status, "confirmed");
      assertEquals((await getPaymentOrder(db, "order2"))?.status, "expired");
      assertEquals(
        await reservePaymentOrder(db, {
          ...base,
          orderId: "order3",
          fingerprint: "three",
          createdAt: 300,
          expiresAt: 400,
          graceUntil: 500,
        }, 300),
        false,
      );
      const pending = {
        ...base,
        orderId: "order4",
        username: "unpaid",
        fingerprint: "two",
        proofNonce: 2,
        createdAt: 300,
        expiresAt: 400,
        graceUntil: 500,
      };
      assertEquals(await reservePaymentOrder(db, pending, 300), true);
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order4",
          "two",
          "b".repeat(64),
          400,
        ),
        false,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order4",
          "two",
          "b".repeat(64),
          399,
        ),
        true,
      );
      await expirePaymentOrders(db, 500);
      assertEquals(
        (await getPaymentOrder(db, "order4"))?.status,
        "manual_review",
      );
      assertEquals(
        await confirmPaymentOrder(db, "order4", "b".repeat(64), 500),
        false,
      );
    } finally {
      await db.close();
    }
  },
});
