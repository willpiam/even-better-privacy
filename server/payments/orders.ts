import type { DatabaseAdapter } from "../db/adapter.ts";
import { quoteAtomicUnits } from "./quote.ts";

export type PaymentOrder = {
  orderId: string;
  username: string;
  domain: string;
  fingerprint: string;
  proofNonce: number;
  asset: string;
  network:
    | "ethereum-mainnet"
    | "ethereum-sepolia"
    | "cardano-mainnet"
    | "cardano-preview";
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

/** Release only expired unpaid holds; confirmed purchases are never released. */
export async function expirePaymentOrders(
  db: DatabaseAdapter,
  now: number,
): Promise<void> {
  await db.query(
    `UPDATE mail_payment_orders SET status = 'expired', active = 0
    WHERE active = 1 AND status = 'quoted' AND expires_at <= ?`,
    [now],
  );
  await db.query(
    `UPDATE mail_payment_orders SET status = 'manual_review', active = 0
    WHERE active = 1 AND status = 'pending' AND grace_until <= ?`,
    [now],
  );
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
    !/^[1-9][0-9]*$/.test(order.amountAtomic)
  ) throw new Error("invalid payment order");
  if (
    quoteAtomicUnits(order.usdCents, order.usdPerToken, order.decimals)
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

/** A transaction can be bound to only one order on a given network. */
export async function submitPaymentTransaction(
  db: DatabaseAdapter,
  orderId: string,
  fingerprint: string,
  transactionId: string,
  now: number,
): Promise<boolean> {
  const hash = transactionId.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  try {
    const rows = await db.query<[string]>(
      `UPDATE mail_payment_orders SET transaction_id = ?, status = 'pending'
      WHERE order_id = ? AND identity_fingerprint = ? AND status = 'quoted' AND active = 1 AND expires_at > ?
      RETURNING order_id`,
      [hash, orderId, fingerprint, now],
    );
    return rows.length === 1;
  } catch (err) {
    if (/unique|duplicate/i.test(String(err))) return false;
    throw err;
  }
}

/** Only a verifier may call this after independently validating chain evidence. */
export async function confirmPaymentOrder(
  db: DatabaseAdapter,
  orderId: string,
  transactionId: string,
  now: number,
): Promise<boolean> {
  const rows = await db.query<[string]>(
    `UPDATE mail_payment_orders SET status = 'confirmed'
    WHERE order_id = ? AND transaction_id = ? AND status = 'pending' AND active = 1 AND grace_until > ?
    RETURNING order_id`,
    [orderId, transactionId.toLowerCase().replace(/^0x/, ""), now],
  );
  return rows.length === 1;
}
