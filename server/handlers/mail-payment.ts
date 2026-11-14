import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import {
  buildMailPaymentOrderDetail,
  isE2eMailUsername,
  MAIL_PAYMENT_ORDER_PATH,
  MAIL_PAYMENT_RECOVER_PATH,
  validateMailUsername,
} from "../../common/MailUsername.ts";
import { readJsonBody } from "../body.ts";
import { json } from "../response.ts";
import { verifyDetailProof } from "../detail.ts";
import type { DatabaseAdapter } from "../db/adapter.ts";
import {
  ensureNewNonce,
  getDetailRecord,
  getIdentity,
  getMailboxByFingerprint,
  isIdentityRevoked,
  isMailboxUsernameTaken,
} from "../db/index.ts";
import {
  isMailE2eAuthorized,
  isMailSignupReady,
  readMailSignupSettings,
} from "./mail-signup.ts";
import {
  paymentConfigMatchesDomain,
  readPaymentConfig,
} from "../payments/config.ts";
import {
  confirmPaymentOrder,
  expirePaymentOrders,
  getPaymentOrder,
  reservePaymentOrder,
  submitPaymentTransaction,
} from "../payments/orders.ts";
import { quoteAtomicUnits } from "../payments/quote.ts";
import { fetchUsdRate } from "../payments/rates.ts";
import {
  verifyCardanoPayment,
  verifyEthereumPayment,
} from "../payments/providers.ts";

const QUOTE_MS = 30 * 60_000;
const GRACE_MS = 2 * 60 * 60_000;

export function handlePaymentConfig(): Response {
  const mail = readMailSignupSettings();
  const config = readPaymentConfig();
  if (
    !isMailSignupReady() || !config ||
    !paymentConfigMatchesDomain(mail.domain, config)
  ) {
    return json({ enabled: false });
  }
  return json({
    enabled: true,
    prices: config.prices,
    assets: config.assets.map(({ network, symbol }) => ({ network, symbol })),
  });
}

export async function handlePaymentCreate(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const mail = readMailSignupSettings();
  const config = readPaymentConfig();
  if (
    !isMailSignupReady() || !config ||
    !paymentConfigMatchesDomain(mail.domain, config)
  ) {
    return json({ error: "paid signup is not enabled" }, 503);
  }
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { fingerprint, username, network, asset, proof } = parsed.data;
  if (
    typeof fingerprint !== "string" || fingerprint.length > 128 ||
    !isValidFingerprintBech32(fingerprint) ||
    typeof username !== "string" || typeof network !== "string" ||
    typeof asset !== "string" ||
    typeof proof !== "string" || proof.length > 100_000
  ) return json({ error: "invalid payment request" }, 400);
  const check = validateMailUsername(username);
  const authorizedTestName = mail.domain === "test.pqpost.com" &&
    isE2eMailUsername(check.username) && isMailE2eAuthorized(req);
  if ((!check.ok && !authorizedTestName) || check.username.length > 8) {
    return json({ error: "invalid paid username" }, 400);
  }
  const chosen = config.assets.find((item) =>
    item.network === network && item.symbol === asset
  );
  if (!chosen) return json({ error: "unsupported payment asset" }, 400);
  const identity = await getIdentity(db, fingerprint);
  if (
    !identity || await isIdentityRevoked(db, fingerprint) ||
    await getMailboxByFingerprint(db, fingerprint)
  ) {
    return json({ error: "identity cannot register a mailbox" }, 400);
  }
  const existingEmail = await getDetailRecord(db, fingerprint, "email");
  if (existingEmail && existingEmail.revoked_at === null) {
    return json({ error: "this identity already has an email detail" }, 409);
  }
  if (await isMailboxUsernameTaken(db, check.username, mail.domain)) {
    return json({ error: "That address is taken." }, 409);
  }
  const proofResult = verifyDetailProof(
    identity,
    MAIL_PAYMENT_ORDER_PATH,
    buildMailPaymentOrderDetail(
      `${check.username}@${mail.domain}`,
      network,
      asset,
    ),
    proof,
  );
  const now = Date.now();
  if (
    !proofResult.ok || proofResult.record.timestamp < now - 10 * 60_000 ||
    proofResult.record.timestamp > now + 2 * 60_000
  ) {
    return json({ error: "invalid or expired payment authorization" }, 400);
  }
  if (!(await ensureNewNonce(db, fingerprint, proofResult.record.nonce)).ok) {
    return json({ error: "payment authorization already used" }, 400);
  }
  let rate = "1";
  try {
    if (asset === "ETH" || asset === "ADA") {
      rate = await fetchUsdRate(asset, config.coinGeckoKey, now);
    }
  } catch {
    return json({ error: "exchange rate unavailable; please retry" }, 503);
  }
  const usdCents = config.prices[check.username.length];
  const amountAtomic = quoteAtomicUnits(usdCents, rate, chosen.decimals)
    .toString();
  const orderId = crypto.randomUUID();
  const reserved = await reservePaymentOrder(db, {
    orderId,
    username: check.username,
    domain: mail.domain,
    fingerprint,
    proofNonce: proofResult.record.nonce,
    asset,
    network: chosen.network,
    recipient: chosen.recipient,
    assetUnit: chosen.unit,
    usdCents,
    amountAtomic,
    decimals: chosen.decimals,
    usdPerToken: rate,
    confirmations: chosen.network.startsWith("ethereum-")
      ? config.ethereumConfirmations
      : config.cardanoConfirmations,
    // The on-chain reference is public; it must not reveal the checkout capability.
    message: `pqpost:${crypto.randomUUID()}`,
    createdAt: now,
    expiresAt: now + QUOTE_MS,
    graceUntil: now + QUOTE_MS + GRACE_MS,
  }, now);
  if (!reserved) {
    return json({
      error:
        "Name or identity already has an active reservation, or authorization was used.",
    }, 409);
  }
  return json({ orderId });
}

/** Recover a checkout capability only with a fresh proof from the owning identity. */
export async function handlePaymentRecover(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { fingerprint, username, proof } = parsed.data;
  const mail = readMailSignupSettings();
  if (
    typeof fingerprint !== "string" || fingerprint.length > 128 ||
    !isValidFingerprintBech32(fingerprint) ||
    typeof username !== "string" || typeof proof !== "string" ||
    proof.length > 100_000
  ) {
    return json({ error: "invalid recovery request" }, 400);
  }
  const check = validateMailUsername(username);
  if (
    !check.ok || check.username.length > 8 ||
    !["pqpost.com", "test.pqpost.com"].includes(mail.domain)
  ) {
    return json({ error: "invalid recovery request" }, 400);
  }
  const identity = await getIdentity(db, fingerprint);
  if (!identity || await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "invalid identity" }, 400);
  }
  const result = verifyDetailProof(
    identity,
    MAIL_PAYMENT_RECOVER_PATH,
    `${check.username}@${mail.domain}`,
    proof,
  );
  const now = Date.now();
  if (
    !result.ok || result.record.timestamp < now - 10 * 60_000 ||
    result.record.timestamp > now + 2 * 60_000 ||
    !(await ensureNewNonce(db, fingerprint, result.record.nonce)).ok
  ) {
    return json({ error: "invalid recovery authorization" }, 400);
  }
  await expirePaymentOrders(db, now);
  const rows = await db.query<[string]>(
    `SELECT order_id FROM mail_payment_orders
    WHERE username = ? AND domain = ? AND identity_fingerprint = ?
      AND (active = 1 AND status IN ('quoted', 'pending', 'confirmed') OR status = 'manual_review')
    ORDER BY created_at DESC LIMIT 1`,
    [check.username, mail.domain, fingerprint],
  );
  return json({ orderId: rows[0]?.[0] ?? null });
}

function validOrderId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(value);
}

/** Order ID is an unguessable checkout capability. It never authorizes a change of identity or address. */
export async function handlePaymentOrder(
  req: Request,
  db: DatabaseAdapter,
  submit: boolean,
): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { orderId, transactionId } = parsed.data;
  if (!validOrderId(orderId)) return json({ error: "invalid order" }, 400);
  const now = Date.now();
  await expirePaymentOrders(db, now);
  let order = await getPaymentOrder(db, orderId);
  if (!order) return json({ error: "order not found" }, 404);
  if (submit) {
    if (
      typeof transactionId !== "string" ||
      !await submitPaymentTransaction(
        db,
        orderId,
        order.fingerprint,
        transactionId,
        now,
      )
    ) {
      return json({ error: "transaction could not be submitted" }, 409);
    }
    order = (await getPaymentOrder(db, orderId))!;
  }
  if (order.status === "pending") {
    const config = readPaymentConfig();
    if (
      !config ||
      !config.assets.some((entry) => entry.network === order!.network)
    ) return json({ error: "payment verification unavailable" }, 503);
    const expected = {
      recipient: order.recipient,
      amount: BigInt(order.amountAtomic),
      message: order.message,
      confirmations: order.confirmations,
    };
    try {
      const result = order.network.startsWith("ethereum-")
        ? await verifyEthereumPayment({
          rpcUrl: config.ethereumRpcUrl,
          network: order.network === "ethereum-sepolia" ? "sepolia" : "mainnet",
          txHash: `0x${order.transactionId}`,
          tokenContract: order.assetUnit === "native"
            ? undefined
            : order.assetUnit,
          expected,
        })
        : await verifyCardanoPayment({
          apiKey: config.blockfrostKey,
          network: order.network === "cardano-preview" ? "preview" : "mainnet",
          txHash: order.transactionId!,
          assetUnit: order.assetUnit,
          expected,
        });
      if (result === "confirmed") {
        // A concurrent mailbox signup or an operator-created name must never
        // turn a payment into an entitlement that cannot be fulfilled.
        const emailDetail = await getDetailRecord(
          db,
          order.fingerprint,
          "email",
        );
        if (
          await getMailboxByFingerprint(db, order.fingerprint) ||
          await isMailboxUsernameTaken(db, order.username, order.domain) ||
          await isIdentityRevoked(db, order.fingerprint) ||
          (emailDetail && emailDetail.revoked_at === null)
        ) {
          await db.query(
            "UPDATE mail_payment_orders SET status = 'manual_review', active = 0 WHERE order_id = ? AND status = 'pending'",
            [orderId],
          );
          order = (await getPaymentOrder(db, orderId))!;
        } else {
          await confirmPaymentOrder(
            db,
            orderId,
            order.transactionId!,
            Date.now(),
          );
          order = (await getPaymentOrder(db, orderId))!;
        }
      } else if (result === "invalid") {
        await db.query(
          `UPDATE mail_payment_orders SET status = 'manual_review', active = 0 WHERE order_id = ? AND status = 'pending'`,
          [orderId],
        );
        order = (await getPaymentOrder(db, orderId))!;
      }
    } catch {
      return json(
        { error: "payment verification temporarily unavailable" },
        503,
      );
    }
  }
  return json({
    orderId: order.orderId,
    email: `${order.username}@${order.domain}`,
    fingerprint: order.fingerprint,
    asset: order.asset,
    network: order.network,
    recipient: order.recipient,
    assetUnit: order.assetUnit,
    usdCents: order.usdCents,
    amountAtomic: order.amountAtomic,
    decimals: order.decimals,
    confirmations: order.confirmations,
    message: order.message,
    expiresAt: order.expiresAt,
    graceUntil: order.graceUntil,
    status: order.status,
    transactionId: order.transactionId,
  });
}

/** Reconcile pending payments without requiring the buyer to keep checkout open. */
export async function reconcilePendingPayments(
  db: DatabaseAdapter,
): Promise<void> {
  await expirePaymentOrders(db, Date.now());
  const rows = await db.query<[string]>(
    `SELECT order_id FROM mail_payment_orders
    WHERE status = 'pending' AND active = 1 ORDER BY last_checked, created_at LIMIT 50`,
  );
  for (let index = 0; index < rows.length; index += 5) {
    await Promise.all(
      rows.slice(index, index + 5).map(async ([orderId]) => {
        await db.query(
          "UPDATE mail_payment_orders SET last_checked = ? WHERE order_id = ? AND status = 'pending'",
          [Date.now(), orderId],
        );
        try {
          const response = await handlePaymentOrder(
            new Request("http://localhost/internal/payment-status", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ orderId }),
            }),
            db,
            false,
          );
          if (!response.ok) {
            console.error(
              `payment reconciliation returned HTTP ${response.status}`,
            );
          }
          await response.body?.cancel();
        } catch (error) {
          console.error("payment reconciliation failed:", error);
        }
      }),
    );
  }
}
