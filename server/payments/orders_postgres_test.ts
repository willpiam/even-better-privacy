import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { initDb } from "../db/index.ts";
import {
  getPaymentOrder,
  type PaymentOrder,
  reservePaymentOrder,
  submitPaymentTransaction,
} from "./orders.ts";

Deno.test({
  name: "PostgreSQL payment uniqueness and transaction claims",
  ignore: Deno.env.get("PAYMENT_TEST_POSTGRES") !== "true",
  sanitizeResources: false,
  sanitizeOps: false,
  async fn() {
    const db = await initDb(":memory:");
    const suffix = crypto.randomUUID();
    const first = `test-${suffix}`;
    const second = `test2-${suffix}`;
    try {
      for (const fp of [first, second]) {
        await db.query(
          `INSERT INTO identities (fingerprint, signing_key_type, encryption_key_type, signing_key, encryption_key, created_at) VALUES (?, 'dilithium', 'kyber', 'key', 'key', 0)`,
          [fp],
        );
      }
      const now = Date.now();
      const order: PaymentOrder = {
        orderId: suffix,
        username: `name-${suffix}`,
        domain: "test.pqpost.com",
        fingerprint: first,
        proofNonce: 1,
        asset: "USDC",
        network: "ethereum-sepolia",
        recipient: "recipient",
        assetUnit: "token",
        usdCents: 100,
        amountAtomic: "1000000",
        decimals: 6,
        usdPerToken: "1",
        confirmations: 5,
        message: "message",
        createdAt: now,
        expiresAt: now + 60_000,
        graceUntil: now + 120_000,
      };
      assertEquals(await reservePaymentOrder(db, order, now), true);
      assertEquals(
        await reservePaymentOrder(db, {
          ...order,
          orderId: crypto.randomUUID(),
          fingerprint: second,
        }, now),
        false,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          order.orderId,
          first,
          `0x${"a".repeat(64)}`,
          now,
        ),
        true,
      );
      const read = await getPaymentOrder(db, order.orderId);
      assertEquals(read?.status, "pending");
      assertEquals(read?.transactionId, "a".repeat(64));
    } finally {
      await db.query(
        "DELETE FROM mail_payment_orders WHERE identity_fingerprint IN (?, ?)",
        [first, second],
      );
      await db.query("DELETE FROM identities WHERE fingerprint IN (?, ?)", [
        first,
        second,
      ]);
      await db.close();
    }
  },
});
