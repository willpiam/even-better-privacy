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
  consumeNonce,
  getDetailRecord,
  getIdentity,
  getMailboxByFingerprint,
  isIdentityRevoked,
  isMailboxUsernameTaken,
} from "../db/index.ts";
import {
  isMailE2eAuthorized,
  isMailSignupReady,
  mailModeFromRequest,
  mailSettingsForMode,
  paymentPrefixForDomain,
  paymentConfigForSettings,
  TEST_MAIL_DOMAIN,
} from "./mail-signup.ts";
import {
  cancelUnpaidPaymentOrder,
  confirmPaymentOrder,
  expirePaymentOrder,
  expirePaymentOrders,
  getPaymentOrder,
  paymentTransactionIds,
  reservePaymentOrder,
  submitPaymentTransaction,
  type StoredOrder,
} from "../payments/orders.ts";
import { readPaymentProvider } from "../payments/config.ts";
import { quoteAtomicUnits } from "../payments/quote.ts";
import { fetchUsdRate } from "../payments/rates.ts";
import {
  verifyCardanoPayment,
  createEthereumPaymentVerifier,
} from "../payments/providers.ts";
import {
  assembleSignedTransaction,
  bech32Address,
  buildPreviewUnsigned,
  cardanoPayError,
  previewBlockfrost,
  previewTransactionCosts,
  utxoFromCip30,
  selectWalletUtxos,
} from "../payments/cardano_tx.ts";

const QUOTE_MS = 30 * 60_000;
const GRACE_MS = 2 * 60 * 60_000;
const TEST_PAYMENT_NETWORKS = new Set(["ethereum-sepolia", "cardano-preview"]);

function checkoutAssets(config: NonNullable<ReturnType<typeof paymentConfigForSettings>>) {
  return config.assets.filter(({ network }) => TEST_PAYMENT_NETWORKS.has(network));
}

async function paymentQuote(
  config: NonNullable<ReturnType<typeof paymentConfigForSettings>>,
  chosen: ReturnType<typeof checkoutAssets>[number],
  usdCents: number,
  now: number,
) {
  let rate = "1";
  if (chosen.symbol === "ETH" || chosen.symbol === "ADA") {
    try {
      rate = await fetchUsdRate(chosen.symbol, config.alchemyApiKey, now);
    } catch {
      return null;
    }
  }
  return {
    asset: chosen.symbol,
    network: chosen.network,
    recipient: chosen.recipient,
    assetUnit: chosen.unit,
    amountAtomic: quoteAtomicUnits(usdCents, rate, chosen.decimals).toString(),
    decimals: chosen.decimals,
    usdPerToken: rate,
    confirmations: chosen.network.startsWith("ethereum-")
      ? config.ethereumConfirmations
      : config.cardanoConfirmations,
  };
}

export function handlePaymentConfig(req?: Request): Response {
  const mail = mailSettingsForMode(req ? mailModeFromRequest(req) : "production");
  const config = paymentConfigForSettings(mail);
  if (!isMailSignupReady() || !config) {
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
  const mail = mailSettingsForMode(mailModeFromRequest(req));
  const config = paymentConfigForSettings(mail);
  if (!isMailSignupReady() || !config) {
    return json({ error: "paid signup is not enabled" }, 503);
  }
  if (mail.domain !== TEST_MAIL_DOMAIN) {
    return json({
      error: "Names shorter than 9 characters are not available for registration yet.",
    }, 400);
  }
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { fingerprint, username, network, asset, proof } = parsed.data;
  if (
    typeof fingerprint !== "string" || fingerprint.length > 128 ||
    typeof username !== "string" || typeof network !== "string" ||
    typeof asset !== "string" ||
    typeof proof !== "string" || proof.length > 100_000
  ) return json({ error: "invalid payment request" }, 400);
  const deferred = network === "" && asset === "";
  if (!deferred && !TEST_PAYMENT_NETWORKS.has(network)) {
    return json({ error: "unsupported payment asset" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "invalid payment request" }, 400);
  }
  const check = validateMailUsername(username);
  const authorizedTestName = mail.domain === "test.pqpost.com" &&
    isE2eMailUsername(check.username) && isMailE2eAuthorized(req);
  if ((!check.ok && !authorizedTestName) || check.username.length > 8) {
    return json({ error: "invalid paid username" }, 400);
  }
  const assets = checkoutAssets(config);
  const chosen = assets.find((item) => item.network === network && item.symbol === asset);
  if (!chosen && (!deferred || !assets.length)) {
    return json({ error: "unsupported payment asset" }, 400);
  }
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
  const usdCents = config.prices[check.username.length];
  // An empty network reserves the address without an on-chain quote.
  const quote = chosen ? await paymentQuote(config, chosen, usdCents, now) : {
    asset: "",
    network: "" as const,
    recipient: "",
    assetUnit: "",
    amountAtomic: "0",
    decimals: 0,
    usdPerToken: "1",
    confirmations: 1,
  };
  if (!quote) return json({ error: "exchange rate unavailable; please retry" }, 503);
  const orderId = crypto.randomUUID();
  const reserved = await db.writeTransaction(async (tx) => {
    if (await getMailboxByFingerprint(tx, fingerprint) ||
      await isMailboxUsernameTaken(tx, check.username, mail.domain)) return false;
    if (!(await consumeNonce(tx, fingerprint, proofResult.record.nonce)).ok) return false;
    return await reservePaymentOrder(tx, {
      orderId,
      username: check.username,
      domain: mail.domain,
      fingerprint,
      proofNonce: proofResult.record.nonce,
      ...quote,
      usdCents,
      // The on-chain reference is public and separate from the checkout capability.
      message: `pqpost:${crypto.randomUUID()}`,
      createdAt: now,
      expiresAt: now + QUOTE_MS,
      graceUntil: now + QUOTE_MS + GRACE_MS,
    }, now);
  }, `identity:${fingerprint}`);
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
  const { fingerprint, username, proof, forCancellation } = parsed.data;
  const mail = mailSettingsForMode(mailModeFromRequest(req));
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
  const consumed = await db.writeTransaction(tx => consumeNonce(tx, fingerprint, result.record.nonce), `identity:${fingerprint}`);
  if (!consumed.ok) return json({error: consumed.error}, 400);
  await expirePaymentOrders(db, now);
  const rows = await db.query<[string]>(
    `SELECT order_id FROM mail_payment_orders
    WHERE username = ? AND domain = ? AND identity_fingerprint = ?
      AND (? = 1 OR active = 1 AND status IN ('quoted', 'pending', 'confirmed') OR status = 'manual_review')
    ORDER BY active DESC, created_at DESC LIMIT 1`,
    [check.username, mail.domain, fingerprint, forCancellation === true ? 1 : 0],
  );
  return json({ orderId: rows[0]?.[0] ?? null, ...(forCancellation === true ? {cancellationLookup: true} : {}) });
}

function validOrderId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      .test(value);
}

export async function handlePaymentCancel(req: Request, db: DatabaseAdapter): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { orderId, confirmUnpaid } = parsed.data;
  if (!validOrderId(orderId) || confirmUnpaid !== true) {
    return json({ error: "Confirm that you haven't sent payment to cancel this order." }, 400);
  }
  const order = await cancelUnpaidPaymentOrder(db, orderId, Date.now());
  if (!order) return json({ error: "order not found" }, 404);
  if (order.status === "cancelled") return json({ status: "cancelled" });
  const message = order.status === "manual_review"
    ? "This payment needs review. Contact support with your transaction ID."
    : order.status === "pending" || order.status === "confirmed"
    ? "Payment is already recorded. Check payment to continue setup."
    : "A mailbox is already associated with this purchase. Restore mailbox access to continue.";
  return json({
    status: order.status,
    error: message,
  }, 409);
}

async function preparePaymentSelection(order: StoredOrder, network: unknown, asset: unknown) {
  if (order.domain !== TEST_MAIL_DOMAIN || order.network || !order.active ||
    order.status !== "quoted" || order.graceUntil <= Date.now()) {
    return { error: json({ error: "Payment selection is closed. Refresh the order status." }, 409) };
  }
  const config = paymentConfigForSettings(mailSettingsForMode("test"));
  if (!config || !isMailSignupReady()) return { error: json({ error: "paid signup is not enabled" }, 503) };
  const chosen = checkoutAssets(config).find((item) => item.network === network && item.symbol === asset);
  if (!chosen) return { error: json({ error: "unsupported payment asset" }, 400) };
  const quote = await paymentQuote(config, chosen, order.usdCents, Date.now());
  if (!quote) return { error: json({ error: "exchange rate unavailable; please retry" }, 503) };
  return { quote };
}

/** Lock in the first asset selected by the holder of the checkout capability. */
export async function handlePaymentSelect(req: Request, db: DatabaseAdapter): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { orderId, network, asset, preview } = parsed.data;
  if (!validOrderId(orderId)) return json({ error: "invalid order" }, 400);
  const order = await getPaymentOrder(db, orderId);
  if (!order) return json({ error: "order not found" }, 404);
  const { quote, error } = await preparePaymentSelection(order, network, asset);
  if (error) return error;
  const now = Date.now();
  if (preview === true) {
    return json({
      email: `${order.username}@${order.domain}`,
      status: "quoted",
      ...quote,
      message: order.message,
      expiresAt: now + QUOTE_MS,
    });
  }
  const rows = await db.query<[string]>(
    `UPDATE mail_payment_orders SET asset = ?, network = ?, recipient = ?, asset_unit = ?,
      amount_atomic = ?, decimals = ?, usd_per_token = ?, confirmations = ?, expires_at = ?, grace_until = ?
    WHERE order_id = ? AND active = 1 AND status = 'quoted' AND network = '' AND grace_until > ?
    RETURNING order_id`,
    [quote.asset, quote.network, quote.recipient, quote.assetUnit, quote.amountAtomic, quote.decimals,
      quote.usdPerToken, quote.confirmations, now + QUOTE_MS, now + QUOTE_MS + GRACE_MS, orderId, now],
  );
  if (!rows.length) return json({ error: "Payment selection is closed. Refresh the order status." }, 409);
  return json({ orderId });
}

/** Order ID is an unguessable checkout capability. It never authorizes a change of identity or address. */
export async function handlePaymentOrder(
  req: Request,
  db: DatabaseAdapter,
  submit: boolean,
): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { orderId, transactionId, checkPayment } = parsed.data;
  if (!validOrderId(orderId)) return json({ error: "invalid order" }, 400);
  const now = Date.now();
  let order = await getPaymentOrder(db, orderId);
  if (!order) return json({ error: "order not found" }, 404);
  order = await expirePaymentOrder(db, order, now);
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
      if ((await getPaymentOrder(db, orderId))?.status === "cancelled") {
        return json({ error: "This purchase was cancelled. Contact support with your transaction ID if you sent payment." }, 409);
      }
      return json({ error: "transaction could not be submitted" }, 409);
    }
    order = (await getPaymentOrder(db, orderId))!;
  }
  const progress: Partial<PaymentProgress> = {};
  if (submit || checkPayment !== false) {
    try {
      order = await refreshPaymentOrder(db, order, (value) => { Object.assign(progress, value); });
    } catch (error) {
      if (!(error instanceof PaymentRefreshError)) throw error;
      // Submission already committed. Let checkout acknowledge the saved hash.
      if (!submit) return json({ error: error.message }, 503);
    }
  }
  if (!order.network) {
    const config = order.domain === TEST_MAIL_DOMAIN && isMailSignupReady()
      ? paymentConfigForSettings(mailSettingsForMode("test"))
      : null;
    return json({
      orderId: order.orderId,
      email: `${order.username}@${order.domain}`,
      fingerprint: order.fingerprint,
      usdCents: order.usdCents,
      status: order.status,
      testnet: order.domain === TEST_MAIL_DOMAIN,
      paymentAssets: config && order.active && order.status === "quoted"
        ? checkoutAssets(config).map(({ network, symbol }) => ({ network, symbol }))
        : [],
    });
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
    ...progress,
    message: order.message,
    expiresAt: order.expiresAt,
    graceUntil: order.graceUntil,
    status: order.status,
    transactionId: order.transactionId,
  });
}

type PaymentProgress = {
  confirmationsSeen: number;
  paymentMismatch: boolean;
  confirmationTransactionId?: string;
};

export class PaymentRefreshError extends Error {
  readonly retryable = true;
  constructor(readonly stage: string, message: string) { super(message); }
}
/** Domain service shared by the request adapter and scheduled reconciliation. */
export async function refreshPaymentOrder(
  db: DatabaseAdapter,
  order: StoredOrder,
  onProgress?: (progress: PaymentProgress) => void,
): Promise<StoredOrder> {
  if (order.status !== "pending") return order;
  const prefix = paymentPrefixForDomain(order.domain);
  const provider = prefix && order.network && readPaymentProvider(prefix, order.network);
  if (!provider) {
    throw new PaymentRefreshError("configuration", "payment verification unavailable");
  }
  const expected = {
    recipient: order.recipient,
    amount: BigInt(order.amountAtomic),
    message: order.message,
    confirmations: order.confirmations,
  };
  const hashes = await paymentTransactionIds(db, order);
  if (!hashes.length) return order;
  const controller = new AbortController();
  const ethereum = provider.chain === "ethereum"
    ? createEthereumPaymentVerifier({
      rpcUrl: provider.rpcUrl,
      network: provider.network,
      tokenContract: order.assetUnit === "native" ? undefined : order.assetUnit,
      expected,
      signal: controller.signal,
    })
    : null;
  let maxConfirmations = 0;
  let paymentMismatch = true;
  let confirmationTransactionId: string | undefined;
  const unconfirmed = Symbol("unconfirmed");
  let verified: { hash: string; at: number };
  try {
    verified = await Promise.any(hashes.map(async (hash) => {
      const report = (count: number) => {
        if (count > maxConfirmations) {
          maxConfirmations = count;
          confirmationTransactionId = hash;
        }
      };
      const result = provider.chain === "cardano"
        ? await verifyCardanoPayment({
          apiKey: provider.apiKey,
          network: provider.network,
          txHash: hash,
          assetUnit: order.assetUnit,
          expected,
          signal: controller.signal,
          onConfirmations: report,
        })
        : await ethereum!(`0x${hash}`, report);
      if (result !== "invalid") paymentMismatch = false;
      if (result !== "confirmed") throw unconfirmed;
      return { hash, at: Date.now() };
    }));
  } catch (error) {
    if (!(error instanceof AggregateError) || error.errors.some((reason) => reason !== unconfirmed)) {
      throw new PaymentRefreshError("provider", "payment verification temporarily unavailable");
    }
    // Keep the reservation open through grace for reorgs and replacement hashes.
    onProgress?.({ confirmationsSeen: maxConfirmations, paymentMismatch, confirmationTransactionId });
    return order;
  } finally {
    controller.abort();
  }

  await db.writeTransaction(async (tx) => {
    const emailDetail = await getDetailRecord(tx, order.fingerprint, "email");
    const unavailable = await getMailboxByFingerprint(tx, order.fingerprint) ||
      await isMailboxUsernameTaken(tx, order.username, order.domain) ||
      await isIdentityRevoked(tx, order.fingerprint) ||
      (emailDetail && emailDetail.revoked_at === null);
    await confirmPaymentOrder(
      tx,
      order.orderId,
      verified.hash,
      verified.at,
      unavailable ? "manual_review" : "confirmed",
    );
  }, `identity:${order.fingerprint}`);
  return (await getPaymentOrder(db, order.orderId))!;
}

const MAX_WALLET_UTXOS = 256;

function cardanoFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "Could not build the Cardano transaction.";
  if (/blockfrost|project_id|api key/i.test(message)) {
    return "Cardano payment is temporarily unavailable.";
  }
  return message;
}

async function quotedCardanoOrder(db: DatabaseAdapter, orderId: unknown): Promise<
  { order: Awaited<ReturnType<typeof getPaymentOrder>> & object; error?: undefined } | { order?: undefined; error: Response }
> {
  if (typeof orderId !== "string" || orderId.length > 80) {
    return { error: json({ error: "invalid cardano payment request" }, 400) };
  }
  const order = await getPaymentOrder(db, orderId);
  if (!order) return { error: json({ error: "unknown order" }, 404) };
  const refusal = cardanoPayError(order, Date.now());
  if (refusal) return { error: json({ error: refusal }, 400) };
  return { order };
}

export async function handleCardanoUnsigned(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const { orderId, changeAddress, utxos, preview, network, asset } = parsed.data;
  let order: StoredOrder;
  if (preview === true) {
    if (!validOrderId(orderId) || network !== "cardano-preview") {
      return json({ error: "invalid Cardano preview" }, 400);
    }
    const reservation = await getPaymentOrder(db, orderId);
    if (!reservation) return json({ error: "order not found" }, 404);
    const { quote, error } = await preparePaymentSelection(reservation, network, asset);
    if (error) return error;
    order = { ...reservation, ...quote, message: `pqpost:${"0".repeat(36)}`, expiresAt: Date.now() + QUOTE_MS };
  } else {
    const loaded = await quotedCardanoOrder(db, orderId);
    if (loaded.error) return loaded.error;
    order = loaded.order;
  }
  if (
    typeof changeAddress !== "string" || changeAddress.length > 200 ||
    !Array.isArray(utxos) || utxos.length === 0 || utxos.length > MAX_WALLET_UTXOS
  ) {
    return json({ error: "invalid cardano payment request" }, 400);
  }
  const prefix = paymentPrefixForDomain(order.domain);
  const provider = prefix && order.network && readPaymentProvider(prefix, order.network);
  if (!provider || provider.chain !== "cardano") {
    return json({ error: "cardano payment is not configured" }, 503);
  }
  try {
    const change = bech32Address(changeAddress);
    const candidates = selectWalletUtxos(utxos.map((hex) => {
      if (typeof hex !== "string" || !/^[0-9a-f]+$/i.test(hex) || hex.length > 8000) {
        throw new Error("The wallet did not provide a usable testnet address or funds.");
      }
      return utxoFromCip30(hex);
    }), order.assetUnit);
    const chain = previewBlockfrost(provider.apiKey);
    const inputs = await chain.getUtxosByOutRef(candidates.map(({ txHash, outputIndex }) => ({ txHash, outputIndex })));
    if (!inputs.length) {
      throw new Error("No spendable wallet inputs were found on Cardano Preview. Check your wallet network.");
    }
    const unsignedTx = await buildPreviewUnsigned(order, { changeAddress: change, utxos: inputs }, chain);
    const costs = previewTransactionCosts(unsignedTx, order);
    return json(preview === true ? costs : { unsignedTx, changeAddress: change, ...costs });
  } catch (error) {
    return json({ error: cardanoFailure(error) }, 400);
  }
}

export async function handleCardanoAssemble(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
  const loaded = await quotedCardanoOrder(db, parsed.data.orderId);
  if (loaded.error) return loaded.error;
  const { unsignedTx, witnessSet } = parsed.data;
  if (
    typeof unsignedTx !== "string" || typeof witnessSet !== "string" ||
    !/^[0-9a-f]+$/i.test(unsignedTx) || !/^[0-9a-f]+$/i.test(witnessSet) ||
    unsignedTx.length > 100_000 || witnessSet.length > 100_000
  ) {
    return json({ error: "invalid cardano payment request" }, 400);
  }
  try {
    return json({
      signedTx: assembleSignedTransaction(unsignedTx, witnessSet, loaded.order),
    });
  } catch (error) {
    return json({ error: cardanoFailure(error) }, 400);
  }
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
        try {
          await db.query("UPDATE mail_payment_orders SET last_checked = ? WHERE order_id = ? AND status = 'pending'", [Date.now(), orderId]);
          const order = await getPaymentOrder(db, orderId);
          if (order) await refreshPaymentOrder(db, order);
        } catch (error) {
          console.error("payment reconciliation failed", {
            orderId,
            stage: error instanceof PaymentRefreshError ? error.stage : "database",
            retryable: error instanceof PaymentRefreshError,
            reason: error instanceof PaymentRefreshError ? error.message : "database operation failed",
          });
        }
      }),
    );
  }
}
