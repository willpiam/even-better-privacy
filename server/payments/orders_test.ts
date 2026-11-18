import { assertEquals } from "jsr:@std/assert@^1.0.6";
import { SqliteDatabaseAdapter } from "../db/sqlite.ts";
import {
  MIGRATE_PAYMENT_CANDIDATES,
  PAYMENT_ORDER_SCHEMA_UPDATES,
} from "../db/payment-schema.ts";
import { handlePaymentCancel } from "../handlers/mail-payment.ts";
import {
  cancelUnpaidPaymentOrder,
  confirmPaymentOrder,
  expirePaymentOrder,
  expirePaymentOrders,
  getPaymentOrder,
  type PaymentOrder,
  paymentTransactionIds,
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
      const firstHash = "a".repeat(64);
      const replacementHash = "c".repeat(64);
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order1",
          "one",
          replacementHash,
          201,
        ),
        true,
      );
      assertEquals(
        await submitPaymentTransaction(db, "order1", "one", firstHash, 202),
        true,
      );
      assertEquals(
        await paymentTransactionIds(db, (await getPaymentOrder(db, "order1"))!),
        [replacementHash, firstHash],
      );
      const another = {
        ...base,
        orderId: "order2",
        username: "other",
        fingerprint: "two",
      };
      assertEquals(await reservePaymentOrder(db, another, 100), true);
      // Filing the same unverified receipt on a different order must not block payment.
      assertEquals(
        await submitPaymentTransaction(db, "order2", "two", firstHash, 250),
        true,
      );
      assertEquals(
        await confirmPaymentOrder(db, "order1", firstHash, 250),
        true,
      );
      assertEquals(
        await confirmPaymentOrder(db, "order2", firstHash, 251),
        false,
      );
      assertEquals(
        (await expirePaymentOrder(
          db,
          (await getPaymentOrder(db, "order2"))!,
          300,
        )).status,
        "manual_review",
      );
      await expirePaymentOrders(db, 300);
      assertEquals((await getPaymentOrder(db, "order1"))?.status, "confirmed");
      assertEquals(
        (await getPaymentOrder(db, "order1"))?.transactionId,
        firstHash,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order1",
          "one",
          replacementHash,
          301,
        ),
        true,
      );
      assertEquals(
        (await getPaymentOrder(db, "order2"))?.status,
        "manual_review",
      );
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
          500,
        ),
        false,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          "order4",
          "two",
          "b".repeat(64),
          400,
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

      const cancellable = {
        ...base,
        orderId: crypto.randomUUID(),
        username: "available",
        fingerprint: "two",
        proofNonce: 3,
        createdAt: 600,
        expiresAt: 700,
        graceUntil: 800,
      };
      assertEquals(await reservePaymentOrder(db, cancellable, 600), true);
      const cancel = (orderId: string, confirmUnpaid: boolean) =>
        handlePaymentCancel(
          new Request("http://localhost/cancel", {
            method: "POST",
            body: JSON.stringify({ orderId, confirmUnpaid }),
          }),
          db,
        );
      assertEquals((await cancel(cancellable.orderId, false)).status, 400);
      assertEquals((await cancel(cancellable.orderId, true)).status, 200);
      assertEquals((await cancel(cancellable.orderId, true)).status, 200);
      const cancelled = await getPaymentOrder(db, cancellable.orderId);
      assertEquals([cancelled?.status, cancelled?.active], [
        "cancelled",
        false,
      ]);
      assertEquals(
        (await db.query<[number]>(
          "SELECT cancelled_at FROM mail_payment_orders WHERE order_id = ?",
          [cancellable.orderId],
        ))[0][0] > 0,
        true,
      );
      assertEquals(
        await submitPaymentTransaction(
          db,
          cancellable.orderId,
          "two",
          "c".repeat(64),
          650,
        ),
        false,
      );
      assertEquals(
        await reservePaymentOrder(db, {
          ...cancellable,
          orderId: "replacement",
          fingerprint: "three",
        }, 600),
        true,
      );

      const [, submitted] = await Promise.all([
        cancelUnpaidPaymentOrder(db, "replacement", 650),
        submitPaymentTransaction(
          db,
          "replacement",
          "three",
          "d".repeat(64),
          650,
        ),
      ]);
      assertEquals(
        (await getPaymentOrder(db, "replacement"))?.status,
        submitted ? "pending" : "cancelled",
      );
      assertEquals(
        (await cancelUnpaidPaymentOrder(db, "order1", 650))?.status,
        "confirmed",
      );
      assertEquals(
        (await cancelUnpaidPaymentOrder(db, "order4", 650))?.status,
        "manual_review",
      );
      // Simulate a completed mailbox from the pre-upgrade schema.
      await db.query(
        `INSERT INTO mailboxes (username, domain, identity_fingerprint, stalwart_id, created_at)
        VALUES (?, ?, ?, 'account', 250)`,
        [base.username, base.domain, base.fingerprint],
      );
      await db.query("DELETE FROM mail_payment_candidates");
      await db.execute(`CREATE TABLE mail_payment_transactions (
        order_id TEXT NOT NULL, network TEXT NOT NULL, transaction_id TEXT NOT NULL, submitted_at BIGINT NOT NULL
      )`);
      await db.query(
        "INSERT INTO mail_payment_transactions VALUES (?, ?, ?, ?)",
        [base.orderId, base.network, replacementHash, 201],
      );
      for (const sql of PAYMENT_ORDER_SCHEMA_UPDATES) await db.execute(sql);
      for (const sql of MIGRATE_PAYMENT_CANDIDATES) await db.execute(sql);
      const migrated = (await getPaymentOrder(db, base.orderId))!;
      assertEquals([migrated.status, migrated.active], ["fulfilled", false]);
      assertEquals(await paymentTransactionIds(db, migrated), [
        firstHash,
        replacementHash,
      ]);
    } finally {
      await db.close();
    }
  },
});
