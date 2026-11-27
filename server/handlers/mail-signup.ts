import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
  buildMailDeleteDetail,
  buildMailPasswordResetDetail,
  isE2eMailUsername,
  MAIL_DELETE_PATH,
  MAIL_PASSWORD_MAX,
  MAIL_PASSWORD_MIN,
  MAIL_PASSWORD_RESET_PATH,
  normalizeMailUsername,
  validateMailUsername,
} from "../../common/MailUsername.ts";
import { LIMITS, readJsonBody, validateStringLength } from "../body.ts";
import { json } from "../response.ts";
import {
  deleteDetail,
  deleteMailbox,
  ensureNewNonce,
  consumeNonce,
  getDetailRecord,
  getIdentity,
  getMailboxByFingerprint,
  getMailboxByUsername,
  insertDetail,
  insertMailbox,
  isIdentityRevoked,
  isMailboxUsernameTaken,
  isMailUsernameRetired,
  listOldE2eMailboxes,
  markDetailVerified,
  retireMailUsername,
  revokeDetail,
  setMailboxStalwartId,
  updateDetail,
} from "../db/index.ts";
import { timingSafeEqual } from "node:crypto";
import {
  fulfillPaymentOrder,
  getActivePaymentOrderId,
  getConfirmedPaymentOrder,
} from "../payments/orders.ts";
import {
  type PaymentConfig,
  type PaymentPrefix,
  paymentConfigMatchesDomain,
  readPaymentConfig,
  readTestPaymentConfig,
} from "../payments/config.ts";
import type { DatabaseAdapter, MailboxRow } from "../db/index.ts";
import { verifyDetailProof } from "../detail.ts";
import {
  readStalwartConfig,
  StalwartClient,
  StalwartCreateRejected,
} from "../stalwart.ts";

// Proofs for password resets and deletes are not stored, so freshness bounds replay.
const RESET_PROOF_MAX_AGE_MS = 10 * 60_000;
const RESET_PROOF_MAX_SKEW_MS = 2 * 60_000;
const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;
const E2E_SECRET_HEADER = "x-ebp-e2e-secret";
const E2E_SECRET_MIN = 16;
const E2E_SWEEP_MIN_HOURS = 1;
const E2E_SWEEP_DEFAULT_HOURS = 6;
const E2E_CLEANUP_MAX = 10;
const PQPOST_FREE_USERNAME_MIN = 9;
const SHORT_ADDRESS_REASON =
  `Names shorter than ${PQPOST_FREE_USERNAME_MIN} characters are not available for registration yet.`;
export const PRODUCTION_MAIL_DOMAIN = "pqpost.com";
export const TEST_MAIL_DOMAIN = "test.pqpost.com";
export const MAIL_MODE_HEADER = "x-ebp-mail-mode";
export type MailMode = "production" | "test";

/** Test addresses are a separate mode. A normal request stays on the server's primary domain. */
export function mailModeFromRequest(req: Request): MailMode {
  if (
    (req.headers.get(MAIL_MODE_HEADER) ?? "").trim().toLowerCase() === "test"
  ) {
    return "test";
  }
  try {
    if (new URL(req.url).searchParams.get("mode") === "test") return "test";
  } catch {
    // A malformed URL cannot select test mode.
  }
  return "production";
}

function isShortPqpostUsername(username: string, domain: string): boolean {
  return (domain === "pqpost.com" || domain === "test.pqpost.com") &&
    username.length < PQPOST_FREE_USERNAME_MIN;
}

function secretEquals(provided: string, expected: string): boolean {
  const providedBytes = new TextEncoder().encode(provided);
  const expectedBytes = new TextEncoder().encode(expected);
  if (providedBytes.length !== expectedBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(providedBytes, expectedBytes);
}

/** True when the request carries the test-only secret. Unset or short secrets never match. */
export function isMailE2eAuthorized(req: Request): boolean {
  const expected = (Deno.env.get("MAIL_E2E_SECRET") ?? "").trim();
  if (expected.length < E2E_SECRET_MIN) return false;
  return secretEquals(req.headers.get(E2E_SECRET_HEADER) ?? "", expected);
}

export type MailSignupSettings = {
  enabled: boolean;
  domain: string;
  host: string;
  quotaBytes: number;
};

export function readMailSignupSettings(): MailSignupSettings {
  const domain = (Deno.env.get("MAIL_DOMAIN") ?? "").trim().toLowerCase();
  const host = (Deno.env.get("MAIL_HOST") ?? "").trim().toLowerCase() ||
    (domain ? `mail.${domain}` : "");
  const quota = Number(Deno.env.get("MAIL_QUOTA_BYTES") ?? "");
  const flag = (Deno.env.get("MAIL_SIGNUP_ENABLED") ?? "false").toLowerCase();
  return {
    enabled: flag === "true" && domain.length > 0,
    domain,
    host,
    quotaBytes: Number.isFinite(quota) && quota > 0
      ? quota
      : DEFAULT_QUOTA_BYTES,
  };
}

/**
 * Test mode on the production server serves test.pqpost.com without changing
 * the primary domain. A server already configured as the test domain stays there.
 */
export function mailSettingsForMode(mode: MailMode): MailSignupSettings {
  const settings = readMailSignupSettings();
  if (mode !== "test" || settings.domain === TEST_MAIL_DOMAIN) return settings;
  if (settings.domain !== PRODUCTION_MAIL_DOMAIN || !settings.enabled) {
    return { ...settings, enabled: false, domain: TEST_MAIL_DOMAIN };
  }
  return { ...settings, domain: TEST_MAIL_DOMAIN };
}

export function paymentConfigForSettings(
  settings: MailSignupSettings,
): PaymentConfig | null {
  const prefix = paymentPrefixForDomain(settings.domain);
  const config = prefix === "MAIL_PAYMENT"
    ? readPaymentConfig()
    : prefix === "MAIL_TEST_PAYMENT"
    ? readTestPaymentConfig()
    : null;
  if (!config || !paymentConfigMatchesDomain(settings.domain, config)) {
    return null;
  }
  return config;
}

export function paymentPrefixForDomain(domain: string): PaymentPrefix | null {
  const primary = readMailSignupSettings();
  if (domain === primary.domain) return "MAIL_PAYMENT";
  if (
    domain === TEST_MAIL_DOMAIN && primary.domain === PRODUCTION_MAIL_DOMAIN
  ) {
    return "MAIL_TEST_PAYMENT";
  }
  return null;
}

let stalwartOverride: StalwartClient | null = null;

/** Tests inject a client backed by a fake fetch. Pass null to reset. */
export function setStalwartClientForTests(client: StalwartClient | null): void {
  stalwartOverride = client;
}

function getStalwartClient(): StalwartClient | null {
  if (stalwartOverride) return stalwartOverride;
  const config = readStalwartConfig();
  return config ? new StalwartClient(config) : null;
}

export function isMailSignupReady(): boolean {
  return readMailSignupSettings().enabled && getStalwartClient() !== null;
}

function connectionInfo(settings: MailSignupSettings) {
  return {
    imap: { host: settings.host, port: 993, secure: true },
    smtp: { host: settings.host, port: 465, secure: true },
  };
}

function disabled(): Response {
  return json({ error: "mail signup is not enabled on this server" }, 503);
}

export function handleMailSignupConfig(req?: Request): Response {
  const settings = mailSettingsForMode(
    req ? mailModeFromRequest(req) : "production",
  );
  const enabled = settings.enabled && getStalwartClient() !== null;
  if (!enabled) return json({ enabled: false });
  return json({
    enabled: true,
    domain: settings.domain,
    ...connectionInfo(settings),
  });
}

export async function handleMailUsernameAvailable(
  url: URL,
  db: DatabaseAdapter,
  req?: Request,
): Promise<Response> {
  const settings = mailSettingsForMode(
    req ? mailModeFromRequest(req) : "production",
  );
  if (!settings.enabled) return disabled();
  const check = validateMailUsername(url.searchParams.get("u") ?? "");
  if (!check.ok) {
    return json({
      available: false,
      username: check.username,
      reason: check.reason,
    });
  }
  if (isShortPqpostUsername(check.username, settings.domain)) {
    // Production short names stay unavailable. Test mode is the only purchase path.
    if (settings.domain !== TEST_MAIL_DOMAIN) {
      return json({
        available: false,
        username: check.username,
        reason: SHORT_ADDRESS_REASON,
      });
    }
    const config = paymentConfigForSettings(settings);
    if (
      config && isMailSignupReady() &&
      !await isMailboxUsernameTaken(db, check.username, settings.domain)
    ) {
      return json({
        available: false,
        purchasable: true,
        username: check.username,
        email: `${check.username}@${settings.domain}`,
        usdCents: config.prices[check.username.length],
        reason: "This address requires a one-time purchase.",
      });
    }
    return json({
      available: false,
      username: check.username,
      reason: SHORT_ADDRESS_REASON,
    });
  }
  const taken = await isMailboxUsernameTaken(
    db,
    check.username,
    settings.domain,
  );
  return json({
    available: !taken,
    username: check.username,
    email: `${check.username}@${settings.domain}`,
    ...(taken ? { reason: "That address is taken." } : {}),
  });
}

function validateMailPassword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length < MAIL_PASSWORD_MIN || value.length > MAIL_PASSWORD_MAX) {
    return null;
  }
  return value;
}

class MailSignupConflict extends Error {}

const MAILBOX_PROVISIONING_LEASE_MS = 2 * 60_000;

async function releaseMailboxProvisioning(
  db: DatabaseAdapter,
  fingerprint: string,
  leaseUntil: number,
  discard: boolean,
): Promise<void> {
  // An older request must never clear another request's lease or a completed mailbox.
  const target = "WHERE identity_fingerprint = ? AND provisioning_until = ? AND stalwart_id IS NULL";
  await db.query(
    discard ? `DELETE FROM mailboxes ${target}` : `UPDATE mailboxes SET provisioning_until = 0 ${target}`,
    [fingerprint, leaseUntil],
  );
}

export async function handleMailSignup(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const settings = mailSettingsForMode(mailModeFromRequest(req));
  const stalwart = getStalwartClient();
  if (!settings.enabled || !stalwart) return disabled();

  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(
    payload.fingerprint,
    "fingerprint",
    LIMITS.fingerprint,
  );
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const usernameCheck = validateMailUsername(String(payload.username ?? ""));
  const username = usernameCheck.ok
    ? usernameCheck.username
    : normalizeMailUsername(usernameCheck.username);
  if (
    !usernameCheck.ok &&
    !(isE2eMailUsername(username) && isMailE2eAuthorized(req))
  ) {
    return json({ error: usernameCheck.reason }, 400);
  }
  if (
    isShortPqpostUsername(username, settings.domain) &&
    settings.domain !== TEST_MAIL_DOMAIN
  ) {
    return json({ error: SHORT_ADDRESS_REASON }, 400);
  }
  const paidOrder = isShortPqpostUsername(username, settings.domain)
    ? await getConfirmedPaymentOrder(db, username, settings.domain, fingerprint)
    : null;
  const activeOrder = await getActivePaymentOrderId(db, fingerprint, Date.now());
  if (activeOrder && activeOrder !== paidOrder?.orderId) {
    return json({ error: "this identity has an active address purchase" }, 409);
  }
  if (isShortPqpostUsername(username, settings.domain) && !paidOrder) {
    return json({ error: SHORT_ADDRESS_REASON }, 400);
  }
  const email = `${username}@${settings.domain}`;

  const mailPassword = validateMailPassword(payload.mailPassword);
  if (!mailPassword) {
    return json({
      error:
        `mailPassword must be ${MAIL_PASSWORD_MIN}-${MAIL_PASSWORD_MAX} characters`,
    }, 400);
  }

  const proofCheck = validateStringLength(
    payload.detailProof,
    "detailProof",
    LIMITS.proof,
  );
  if (!proofCheck.ok) return json({ error: proofCheck.error }, 400);
  const detailProof = proofCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json(
      { error: "publish this identity before creating a mailbox" },
      400,
    );
  }
  if (await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "identity is revoked" }, 400);
  }
  const mailbox = await getMailboxByFingerprint(db, fingerprint);
  if (mailbox && (mailbox.stalwartId || mailbox.username !== username || mailbox.domain !== settings.domain)) {
    return json({ error: "this identity already has a mailbox" }, 409);
  }
  if (!mailbox && await isMailboxUsernameTaken(db, username, settings.domain)) {
    return json({ error: "That address is taken." }, 409);
  }
  const existingEmail = await getDetailRecord(db, fingerprint, "email");
  if (existingEmail && existingEmail.revoked_at === null) {
    return json({ error: "this identity already has an email detail" }, 409);
  }

  const proofResult = verifyDetailProof(identity, "email", email, detailProof);
  if (!proofResult.ok) {
    return json({ error: proofResult.error ?? "invalid proof" }, 400);
  }
  const nonceCheck = await ensureNewNonce(
    db,
    fingerprint,
    proofResult.record.nonce,
  );
  if (!nonceCheck.ok) return json({ error: nonceCheck.error }, 400);

  const now = Date.now();
  let leaseUntil: number;
  try {
    leaseUntil = await db.writeTransaction(async (tx) => {
      const acquiredAt = Date.now();
      const activeOrder = await getActivePaymentOrderId(tx, fingerprint, acquiredAt);
      if (activeOrder && activeOrder !== paidOrder?.orderId) {
        throw new MailSignupConflict("this identity has an active address purchase");
      }
      if (paidOrder && (await getConfirmedPaymentOrder(tx, username, settings.domain, fingerprint))?.orderId !== paidOrder.orderId) {
        throw new MailSignupConflict("payment is no longer available for this address");
      }
      const currentMailbox = await getMailboxByFingerprint(tx, fingerprint);
      if (currentMailbox && (currentMailbox.stalwartId || currentMailbox.username !== username || currentMailbox.domain !== settings.domain)) {
        throw new MailSignupConflict("this identity already has a mailbox");
      }
      if (await isMailUsernameRetired(tx, username, settings.domain)) {
        throw new MailSignupConflict("That address is taken.");
      }
      if (!currentMailbox) {
        await insertMailbox(tx, {
          username,
          domain: settings.domain,
          fingerprint,
          stalwartId: null,
          createdAt: now,
        });
      }
      const lease = acquiredAt + MAILBOX_PROVISIONING_LEASE_MS;
      const rows = await tx.query(
        `UPDATE mailboxes SET provisioning_until = ?
          WHERE identity_fingerprint = ? AND stalwart_id IS NULL AND provisioning_until <= ?
          RETURNING id`,
        [lease, fingerprint, acquiredAt],
      );
      if (!rows.length) throw new MailSignupConflict("mailbox setup is already in progress");
      return lease;
    }, `identity:${fingerprint}`);
  } catch (e) {
    if (e instanceof MailSignupConflict) return json({ error: e.message }, 409);
    if (String(e).toUpperCase().includes("UNIQUE")) {
      return json({ error: "That address is taken." }, 409);
    }
    throw e;
  }

  let stalwartId: string;
  try {
    stalwartId = await stalwart.createOrRecoverUser({
      name: username,
      domain: settings.domain,
      password: mailPassword,
      quotaBytes: settings.quotaBytes,
      description: fingerprint,
    });
  } catch (err) {
    const rejected = err instanceof StalwartCreateRejected;
    await releaseMailboxProvisioning(db, fingerprint, leaseUntil, rejected);
    if (rejected && err.code === "already_exists") {
      return json({ error: "That address is taken." }, 409);
    }
    console.error("stalwart createUser failed:", err);
    return json({ error: "mail server could not create the mailbox" }, 502);
  }

  try {
    const completed = await db.writeTransaction(async (db) => {
      if (!await setMailboxStalwartId(db, fingerprint, leaseUntil, stalwartId)) return false;

      // Provisioning happens outside the transaction. Recheck the signed
      // identity state before committing anything after that external call.
      if (await isIdentityRevoked(db, fingerprint)) {
        throw new MailSignupConflict("identity is revoked");
      }
      const currentEmail = await getDetailRecord(db, fingerprint, "email");
      if (currentEmail && currentEmail.revoked_at === null) {
        throw new MailSignupConflict(
          "this identity already has an email detail",
        );
      }
      const currentNonce = await consumeNonce(
        db,
        fingerprint,
        proofResult.record.nonce,
      );
      if (!currentNonce.ok) throw new MailSignupConflict(currentNonce.error);
      const createdAt = proofResult.record.timestamp;
      if (currentEmail) {
        await updateDetail(db, {
          fingerprint,
          path: "email",
          detail: email,
          proof: detailProof,
          createdAt,
        });
      } else {
        await insertDetail(db, {
          fingerprint,
          path: "email",
          detail: email,
          proof: detailProof,
          createdAt,
        });
      }
      await markDetailVerified(db, fingerprint, "email", now);
      if (paidOrder && !await fulfillPaymentOrder(db, paidOrder.orderId)) {
        throw new MailSignupConflict("payment order is no longer available");
      }
      return true;
    }, `identity:${fingerprint}`);
    if (!completed) return json({ error: "mailbox setup was superseded; try again" }, 409);
  } catch (err) {
    let discard = false;
    if (err instanceof MailSignupConflict) {
      if (leaseUntil > Date.now()) {
        try {
          await stalwart.destroyUser(stalwartId);
          discard = true;
        } catch (error) {
          console.error("stalwart rollback failed:", error);
        }
      }
    } else {
      console.error("mailbox signup could not finalize:", err);
    }
    // Preserve confirmed remote work after an uncertain database write. A retry
    // can adopt the same account and commit the still-unconsumed proof.
    await releaseMailboxProvisioning(db, fingerprint, leaseUntil, discard).catch((error) =>
      console.error("mailbox provisioning lease could not be released:", error)
    );
    if (err instanceof MailSignupConflict) {
      return json({ error: err.message }, 409);
    }
    return json({ error: "failed to store mailbox" }, 500);
  }

  return json({
    ok: true,
    email,
    login: email,
    fingerprint,
    ...connectionInfo(settings),
  });
}

export async function handleMailResetPassword(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const settings = readMailSignupSettings();
  const stalwart = getStalwartClient();
  if (!settings.enabled || !stalwart) return disabled();

  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(
    payload.fingerprint,
    "fingerprint",
    LIMITS.fingerprint,
  );
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;

  const mailPassword = validateMailPassword(payload.mailPassword);
  if (!mailPassword) {
    return json({
      error:
        `mailPassword must be ${MAIL_PASSWORD_MIN}-${MAIL_PASSWORD_MAX} characters`,
    }, 400);
  }
  const proofCheck = validateStringLength(payload.proof, "proof", LIMITS.proof);
  if (!proofCheck.ok) return json({ error: proofCheck.error }, 400);

  const identity = await getIdentity(db, fingerprint);
  const mailbox = await getMailboxByFingerprint(db, fingerprint);
  if (!identity || !mailbox || !mailbox.active || !mailbox.stalwartId) {
    return json({ error: "no mailbox for this identity" }, 404);
  }
  if (await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "identity is revoked" }, 400);
  }

  const email = `${mailbox.username}@${mailbox.domain}`;
  const expectedDetail = buildMailPasswordResetDetail(
    email,
    sha256Hex(mailPassword),
  );
  const proofResult = verifyDetailProof(
    identity,
    MAIL_PASSWORD_RESET_PATH,
    expectedDetail,
    proofCheck.value,
  );
  if (!proofResult.ok) {
    return json({ error: proofResult.error ?? "invalid proof" }, 400);
  }
  const age = Date.now() - proofResult.record.timestamp;
  if (age > RESET_PROOF_MAX_AGE_MS || age < -RESET_PROOF_MAX_SKEW_MS) {
    return json({ error: "proof expired; try again" }, 400);
  }

  try {
    await stalwart.setPassword(mailbox.stalwartId, mailPassword);
  } catch (err) {
    console.error("stalwart setPassword failed:", err);
    return json({ error: "mail server could not update the password" }, 502);
  }
  return json({ ok: true, email, ...connectionInfo(settings) });
}

export async function handleMailDelete(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const stalwart = getStalwartClient();
  if (!stalwart) return json({ error: "mailbox deletion is unavailable" }, 503);

  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(
    payload.fingerprint,
    "fingerprint",
    LIMITS.fingerprint,
  );
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;
  const proofCheck = validateStringLength(payload.proof, "proof", LIMITS.proof);
  if (!proofCheck.ok) return json({ error: proofCheck.error }, 400);

  const identity = await getIdentity(db, fingerprint);
  const mailbox = await getMailboxByFingerprint(db, fingerprint);
  const currentEmail = mailbox && `${mailbox.username}@${mailbox.domain}`;
  let email = currentEmail;
  if (payload.email !== undefined) {
    if (typeof payload.email !== "string" || payload.email.length > 254 ||
      !/^[^@\s]+@[^@\s]+$/.test(payload.email)) {
      return json({ error: "invalid mailbox address" }, 400);
    }
    email = payload.email.toLowerCase();
  }
  if (!identity || !email) {
    return json({ error: "no mailbox for this identity" }, 404);
  }

  const proofResult = verifyDetailProof(
    identity,
    MAIL_DELETE_PATH,
    buildMailDeleteDetail(email),
    proofCheck.value,
  );
  if (!proofResult.ok) {
    return json({ error: proofResult.error ?? "invalid proof" }, 400);
  }
  const age = Date.now() - proofResult.record.timestamp;
  if (age > RESET_PROOF_MAX_AGE_MS || age < -RESET_PROOF_MAX_SKEW_MS) {
    return json({ error: "proof expired; try again" }, 400);
  }

  if (!mailbox || email !== currentEmail) {
    const [username, domain] = email.split("@");
    if (await isMailUsernameRetired(db, username, domain, fingerprint)) {
      return json({ ok: true, email });
    }
    return json({ error: "no mailbox for this identity" }, 404);
  }

  try {
    await removeHostedMailbox(db, stalwart, mailbox, proofCheck.value);
    return json({ ok: true, email });
  } catch (err) {
    if (!(err instanceof MailboxDeletionError)) throw err;
    console.error("mailbox deletion failed:", err);
    return json({ error: err.message }, err.status);
  }
}

class MailboxDeletionError extends Error {
  constructor(readonly status: number, message: string, cause?: unknown) {
    super(message, { cause });
  }
}

async function removeHostedMailbox(
  db: DatabaseAdapter,
  stalwart: StalwartClient,
  mailbox: MailboxRow,
  proof: string | null,
): Promise<void> {
  if (!mailbox.stalwartId) throw new MailboxDeletionError(409, "mailbox setup is incomplete");
  try {
    await stalwart.destroyUser(mailbox.stalwartId);
  } catch (err) {
    throw new MailboxDeletionError(502, "mail server could not delete the mailbox", err);
  }

  const { fingerprint, username, domain } = mailbox;
  const email = `${username}@${domain}`;
  const now = Date.now();
  try {
    await db.writeTransaction(async (tx) => {
      const current = await getMailboxByUsername(tx, username, domain);
      if (!current || current.stalwartId !== mailbox.stalwartId || current.fingerprint !== fingerprint) return;

      // The revoked detail keeps the original signup nonce on record.
      const emailDetail = await getDetailRecord(tx, fingerprint, "email");
      if (emailDetail?.revoked_at === null && emailDetail.detail.toLowerCase() === email) {
        await revokeDetail(tx, fingerprint, "email", proof, now);
      }
      await retireMailUsername(tx, { username, domain, fingerprint, retiredAt: now });
      await deleteMailbox(tx, username, domain);
    }, `identity:${fingerprint}`);
  } catch (err) {
    throw new MailboxDeletionError(500, "failed to record mailbox deletion", err);
  }
}

/** Operator-only path for a privately verified deletion request. */
export async function deleteHostedMailboxByAddress(
  db: DatabaseAdapter,
  email: string,
  fingerprint: string,
): Promise<void> {
  const [username, domain, extra] = email.trim().toLowerCase().split("@");
  if (!username || !domain || extra !== undefined) throw new Error("Enter a full mailbox address");
  const mailbox = await getMailboxByUsername(db, username, domain);
  if (!mailbox || mailbox.fingerprint !== fingerprint) throw new Error("No matching hosted mailbox");
  const stalwart = getStalwartClient();
  if (!stalwart) throw new Error("Mail server administration is unavailable");
  await removeHostedMailbox(db, stalwart, mailbox, null);
}

async function removeE2eMailbox(
  db: DatabaseAdapter,
  stalwart: StalwartClient,
  domain: string,
  username: string,
): Promise<void> {
  const mailbox = await getMailboxByUsername(db, username, domain);
  if (!mailbox) return;
  if (mailbox.stalwartId) await stalwart.destroyUser(mailbox.stalwartId);
  await deleteDetail(db, mailbox.fingerprint, "email");
  await deleteMailbox(db, username, domain);
}

export async function handleMailE2eCleanup(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  if (!isMailE2eAuthorized(req)) return json({ error: "not found" }, 404);
  const settings = mailSettingsForMode(mailModeFromRequest(req));
  const stalwart = getStalwartClient();
  if (!settings.enabled || !stalwart) return disabled();

  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const requested: string[] = [];
  if (payload.usernames !== undefined) {
    if (
      !Array.isArray(payload.usernames) ||
      payload.usernames.length > E2E_CLEANUP_MAX
    ) {
      return json({
        error: `usernames must be a list of at most ${E2E_CLEANUP_MAX}`,
      }, 400);
    }
    for (const raw of payload.usernames) {
      const username = normalizeMailUsername(String(raw ?? ""));
      if (!isE2eMailUsername(username)) {
        return json({ error: "only e2e test addresses can be deleted" }, 400);
      }
      requested.push(username);
    }
  }

  let sweepHours: number | null = null;
  if (payload.sweepOlderThanHours !== undefined) {
    const hours = Number(payload.sweepOlderThanHours);
    if (!Number.isFinite(hours) || hours < E2E_SWEEP_MIN_HOURS) {
      return json({
        error: `sweepOlderThanHours must be at least ${E2E_SWEEP_MIN_HOURS}`,
      }, 400);
    }
    sweepHours = hours;
  } else if (requested.length === 0) {
    sweepHours = E2E_SWEEP_DEFAULT_HOURS;
  }

  const targets = new Set(requested);
  if (sweepHours !== null) {
    const olderThan = Date.now() - sweepHours * 60 * 60_000;
    const rows = await listOldE2eMailboxes(db, settings.domain, olderThan);
    for (const row of rows) {
      if (isE2eMailUsername(row.username)) targets.add(row.username);
    }
  }

  const removed: string[] = [];
  try {
    for (const username of targets) {
      await removeE2eMailbox(db, stalwart, settings.domain, username);
      removed.push(username);
    }
  } catch (err) {
    console.error("e2e mailbox cleanup failed:", err);
    return json(
      { error: "mail server could not delete the mailbox", removed },
      502,
    );
  }
  return json({ ok: true, removed });
}
