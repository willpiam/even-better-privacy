import type { DatabaseAdapter } from "../db/adapter.ts";
import type { PaymentNetwork } from "./config.ts";
import { quoteAtomicUnits } from "./quote.ts";

export type PaymentOrder = {
  orderId: string;
  username: string;
  domain: string;
  fingerprint: string;
  proofNonce: number;
  asset: string;
  network: PaymentNetwork | "";
  recipient: string;
  assetUnit: string;
  usdCents: number;
  amountAtomic: string;
  decimals: number;
  usdPerToken: string;
  confirmations: number;
  message: string;
  createdAt: number;
  expiresAt: number;
  graceUntil: number;
};

export type StoredOrder = PaymentOrder & {
  status:
    | "quoted"
    | "pending"
    | "confirmed"
    | "fulfilled"
    | "cancelled"
    | "expired"
    | "manual_review";
  transactionId: string | null;
  active: boolean;
};

type OrderRow = [
  string,
  string,
  string,
  string,
  string,
  StoredOrder["network"],
  string,
  string,
  number | bigint,
  string,
  number | bigint,
  string,
  string,
  StoredOrder["status"],
  number | bigint,
  number | bigint,
  number | bigint,
  string | null,
  number | bigint,
  number | bigint,
  number | bigint,
];
const COLUMNS =
  `order_id, username, domain, identity_fingerprint, asset, network, recipient,
  asset_unit, usd_cents, amount_atomic, decimals, usd_per_token, message, status, created_at, expires_at, grace_until,
  transaction_id, active, proof_nonce, confirmations`;
function fromRow(row: OrderRow): StoredOrder {
  const [
    orderId,
    username,
    domain,
    fingerprint,
    asset,
    network,
    recipient,
    assetUnit,
    usdCents,
    amountAtomic,
    decimals,
    usdPerToken,
    message,
    status,
    createdAt,
    expiresAt,
    graceUntil,
    transactionId,
    active,
    proofNonce,
    confirmations,
  ] = row;
  return {
    orderId,
    username,
    domain,
    fingerprint,
    proofNonce: Number(proofNonce),
    confirmations: Number(confirmations),
    asset,
    network,
    recipient,
    assetUnit,
    usdCents: Number(usdCents),
    amountAtomic,
    decimals: Number(decimals),
    usdPerToken,
    message,
    status,
    createdAt: Number(createdAt),
    expiresAt: Number(expiresAt),
    graceUntil: Number(graceUntil),
    transactionId,
    active: Number(active) === 1,
  };
}

/** Hold inventory through the recovery grace period so delayed wallet approvals can still submit. */
export async function expirePaymentOrders(
  db: DatabaseAdapter,
  now: number,
): Promise<void> {
  await db.query(
    `UPDATE mail_payment_orders SET status = 'expired', active = 0
    WHERE active = 1 AND status = 'quoted' AND grace_until <= ?`,
    [now],
  );
  await db.query(
    `UPDATE mail_payment_orders SET status = 'manual_review', active = 0
    WHERE active = 1 AND status = 'pending' AND grace_until <= ?`,
    [now],
  );
}

export async function expirePaymentOrder(
  db: DatabaseAdapter,
  order: StoredOrder,
  now: number,
): Promise<StoredOrder> {
  if (
    order.graceUntil > now || !order.active ||
    (order.status !== "quoted" && order.status !== "pending")
  ) return order;
  await db.query(
    `UPDATE mail_payment_orders
    SET status = CASE status WHEN 'quoted' THEN 'expired' ELSE 'manual_review' END, active = 0
    WHERE order_id = ? AND active = 1 AND status IN ('quoted', 'pending') AND grace_until <= ?`,
    [order.orderId, now],
  );
  return (await getPaymentOrder(db, order.orderId))!;
}

/** A unique partial index serializes competing reservations across server processes. */
export async function reservePaymentOrder(
  db: DatabaseAdapter,
  order: PaymentOrder,
  now: number,
): Promise<boolean> {
  if (
    order.createdAt !== now || order.expiresAt <= now ||
    order.graceUntil <= order.expiresAt ||
    !Number.isSafeInteger(order.usdCents) || order.usdCents <= 0 ||
    !Number.isSafeInteger(order.proofNonce) || order.proofNonce < 0 ||
    !Number.isSafeInteger(order.confirmations) || order.confirmations < 1 ||
    order.confirmations > 1000 ||
    !Number.isInteger(order.decimals) || order.decimals < 0 ||
    order.decimals > 30 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,18})?$/.test(order.usdPerToken) ||
    !(order.network ? /^[1-9][0-9]*$/.test(order.amountAtomic) : order.amountAtomic === "0")
  ) throw new Error("invalid payment order");
  if (
    order.network && quoteAtomicUnits(order.usdCents, order.usdPerToken, order.decimals)
      .toString() !== order.amountAtomic
  ) {
    throw new Error("payment amount does not match quote");
  }
  await expirePaymentOrders(db, now);
  // ON CONFLICT covers both the active-name and active-identity uniqueness constraints.
  const rows = await db.query<[string]>(
    `INSERT INTO mail_payment_orders
    (order_id, username, domain, identity_fingerprint, proof_nonce, asset, network, recipient, asset_unit,
      usd_cents, amount_atomic, decimals, usd_per_token, confirmations, message, status, created_at, expires_at, grace_until, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'quoted', ?, ?, ?, 1)
    ON CONFLICT DO NOTHING RETURNING order_id`,
    [
      order.orderId,
      order.username,
      order.domain,
      order.fingerprint,
      order.proofNonce,
      order.asset,
      order.network,
      order.recipient,
      order.assetUnit,
      order.usdCents,
      order.amountAtomic,
      order.decimals,
      order.usdPerToken,
      order.confirmations,
      order.message,
      order.createdAt,
      order.expiresAt,
      order.graceUntil,
    ],
  );
  return rows.length === 1;
}

export async function getPaymentOrder(
  db: DatabaseAdapter,
  orderId: string,
): Promise<StoredOrder | null> {
  const rows = await db.query<OrderRow>(
    `SELECT ${COLUMNS} FROM mail_payment_orders WHERE order_id = ?`,
    [orderId],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getConfirmedPaymentOrder(
  db: DatabaseAdapter,
  username: string,
  domain: string,
  fingerprint: string,
): Promise<StoredOrder | null> {
  const rows = await db.query<OrderRow>(
    `SELECT ${COLUMNS} FROM mail_payment_orders WHERE username = ? AND domain = ?
      AND identity_fingerprint = ? AND active = 1 AND status = 'confirmed'`,
    [username, domain, fingerprint],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getActivePaymentOrderId(
  db: DatabaseAdapter,
  fingerprint: string,
  now: number,
): Promise<string | undefined> {
  const rows = await db.query<[string]>(
    `SELECT order_id FROM mail_payment_orders WHERE identity_fingerprint = ? AND active = 1
      AND (status = 'confirmed' OR (status IN ('quoted', 'pending') AND grace_until > ?))`,
    [fingerprint, now],
  );
  return rows[0]?.[0];
}

/** Run with the transaction that consumes the owner's cancellation authorization. */
export async function cancelUnpaidPaymentOrder(
  db: DatabaseAdapter,
  orderId: string,
  now: number,
): Promise<StoredOrder | null> {
  await db.query(
    `UPDATE mail_payment_orders SET status = 'cancelled', active = 0, cancelled_at = ?
      WHERE order_id = ? AND status IN ('quoted', 'expired') AND transaction_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM mailboxes
          WHERE identity_fingerprint = mail_payment_orders.identity_fingerprint
            AND username = mail_payment_orders.username AND domain = mail_payment_orders.domain)`,
    [now, orderId],
  );
  return await getPaymentOrder(db, orderId);
}

const MAX_PAYMENT_TRANSACTIONS = 8;

/** Record an observed payment and retain earlier candidates until a payment confirms. */
export async function submitPaymentTransaction(
  db: DatabaseAdapter,
  orderId: string,
  fingerprint: string,
  transactionId: string,
  now: number,
  paymentReference?: string,
): Promise<boolean> {
  const hash = transactionId.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  return await db.writeTransaction(async (tx) => {
    const order = await getPaymentOrder(tx, orderId);
    if (!order?.network || order.fingerprint !== fingerprint ||
      (paymentReference !== undefined && order.message !== paymentReference)) return false;
    if (!order.active || order.graceUntil <= now ||
      (order.status !== "quoted" && order.status !== "pending")) return false;
    const hashes = await paymentTransactionIds(tx, order);
    if (hashes.includes(hash)) return true;
    if (hashes.length >= MAX_PAYMENT_TRANSACTIONS) return false;

    const rows = await tx.query<[string]>(
      `UPDATE mail_payment_orders SET transaction_id = ?, status = 'pending'
      WHERE order_id = ? AND active = 1 AND status IN ('quoted', 'pending') AND grace_until > ?
        AND NOT EXISTS (
          SELECT 1 FROM mail_payment_orders AS credited
          WHERE credited.network = ? AND credited.transaction_id = ?
            AND credited.transaction_id IS NOT NULL AND credited.status IN ('confirmed', 'fulfilled')
        )
      RETURNING order_id`,
      [hash, orderId, now, order.network, hash],
    );
    if (!rows.length) return false;
    await tx.query(
      `INSERT INTO mail_payment_candidates (order_id, transaction_id, submitted_at)
      VALUES (?, ?, ?)`,
      [orderId, hash, now],
    );
    return true;
  }, `identity:${fingerprint}`);
}

export async function paymentTransactionIds(
  db: DatabaseAdapter,
  order: StoredOrder,
): Promise<string[]> {
  const rows = await db.query<[string]>(
    `SELECT transaction_id FROM mail_payment_candidates
    WHERE order_id = ? ORDER BY submitted_at DESC, transaction_id`,
    [order.orderId],
  );
  // Lead with the latest hash shown in checkout, with a fallback for older orders.
  const hashes = rows.map(([hash]) => hash);
  return order.transactionId
    ? [...new Set([order.transactionId, ...hashes])]
    : hashes;
}

/** Only a verifier may call this after independently validating chain evidence.
 * A newly reported, confirmed payment can bypass the candidate limit.
 * Released reservations go to review so they cannot displace a later purchase.
 */
export async function confirmPaymentOrder(
  db: DatabaseAdapter,
  orderId: string,
  transactionId: string,
  now: number,
  status: "confirmed" | "manual_review" = "confirmed",
  directlySubmitted = false,
): Promise<boolean> {
  const hash = transactionId.toLowerCase().replace(/^0x/, "");
  const rows = await db.query<[string]>(
    `UPDATE mail_payment_orders
    SET status = CASE WHEN active = 1 AND grace_until > ? THEN ? ELSE 'manual_review' END,
        active = CASE WHEN active = 1 AND grace_until > ? AND ? = 'confirmed' THEN 1 ELSE 0 END,
        transaction_id = ?
    WHERE order_id = ? AND (
      (? = 1 AND status IN ('quoted', 'pending', 'cancelled', 'expired', 'manual_review'))
      OR (status = 'pending' AND active = 1 AND grace_until > ?
        AND (transaction_id = ? OR EXISTS (
          SELECT 1 FROM mail_payment_candidates WHERE order_id = ? AND transaction_id = ?
        )))
    )
      AND NOT EXISTS (
        SELECT 1 FROM mail_payment_orders AS credited
        WHERE credited.network = mail_payment_orders.network AND credited.transaction_id = ?
          AND credited.transaction_id IS NOT NULL AND credited.status IN ('confirmed', 'fulfilled')
      )
    RETURNING order_id`,
    [
      now,
      status,
      now,
      status,
      hash,
      orderId,
      directlySubmitted ? 1 : 0,
      now,
      hash,
      orderId,
      hash,
      hash,
    ],
  );
  if (rows.length && directlySubmitted) {
    await db.query(
      `INSERT INTO mail_payment_candidates (order_id, transaction_id, submitted_at)
       VALUES (?, ?, ?) ON CONFLICT (order_id, transaction_id) DO NOTHING`,
      [orderId, hash, now],
    );
  }
  return rows.length === 1;
}

/** Run with the transaction that commits the provisioned mailbox. */
export async function fulfillPaymentOrder(
  db: DatabaseAdapter,
  orderId: string,
): Promise<boolean> {
  const rows = await db.query<[string]>(
    `UPDATE mail_payment_orders SET status = 'fulfilled', active = 0
    WHERE order_id = ? AND status = 'confirmed' AND active = 1 RETURNING order_id`,
    [orderId],
  );
  return rows.length === 1;
}
