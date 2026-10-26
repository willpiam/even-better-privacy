import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import {
  buildMailPasswordResetDetail,
  MAIL_PASSWORD_MAX,
  MAIL_PASSWORD_MIN,
  MAIL_PASSWORD_RESET_PATH,
  validateMailUsername,
} from "../../core/MailUsername.ts";
import { LIMITS, readJsonBody, validateStringLength } from "../body.ts";
import { json } from "../response.ts";
import {
  deleteMailbox,
  ensureNewNonce,
  getDetailRecord,
  getIdentity,
  getMailboxByFingerprint,
  insertDetail,
  insertMailbox,
  isIdentityRevoked,
  isMailboxUsernameTaken,
  markDetailVerified,
  setMailboxStalwartId,
  updateDetail,
} from "../db/index.ts";
import type { DatabaseAdapter } from "../db/index.ts";
import { verifyDetailProof } from "../detail.ts";
import {
  readStalwartConfig,
  StalwartClient,
  StalwartError,
} from "../stalwart.ts";

// Proofs for password resets are not stored, so freshness bounds replay.
const RESET_PROOF_MAX_AGE_MS = 10 * 60_000;
const RESET_PROOF_MAX_SKEW_MS = 2 * 60_000;
const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;

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
    quotaBytes: Number.isFinite(quota) && quota > 0 ? quota : DEFAULT_QUOTA_BYTES,
  };
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

function connectionInfo(settings: MailSignupSettings) {
  return {
    imap: { host: settings.host, port: 993, secure: true },
    smtp: { host: settings.host, port: 465, secure: true },
  };
}

function disabled(): Response {
  return json({ error: "mail signup is not enabled on this server" }, 503);
}

export function handleMailSignupConfig(): Response {
  const settings = readMailSignupSettings();
  const enabled = settings.enabled && getStalwartClient() !== null;
  if (!enabled) return json({ enabled: false });
  return json({ enabled: true, domain: settings.domain, ...connectionInfo(settings) });
}

export async function handleMailUsernameAvailable(
  url: URL,
  db: DatabaseAdapter,
): Promise<Response> {
  const settings = readMailSignupSettings();
  if (!settings.enabled) return disabled();
  const check = validateMailUsername(url.searchParams.get("u") ?? "");
  if (!check.ok) {
    return json({ available: false, username: check.username, reason: check.reason });
  }
  const taken = await isMailboxUsernameTaken(db, check.username, settings.domain);
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

export async function handleMailSignup(
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
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const usernameCheck = validateMailUsername(String(payload.username ?? ""));
  if (!usernameCheck.ok) return json({ error: usernameCheck.reason }, 400);
  const username = usernameCheck.username;
  const email = `${username}@${settings.domain}`;

  const mailPassword = validateMailPassword(payload.mailPassword);
  if (!mailPassword) {
    return json({
      error: `mailPassword must be ${MAIL_PASSWORD_MIN}-${MAIL_PASSWORD_MAX} characters`,
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
    return json({ error: "publish this identity before creating a mailbox" }, 400);
  }
  if (await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "identity is revoked" }, 400);
  }
  if (await getMailboxByFingerprint(db, fingerprint)) {
    return json({ error: "this identity already has a mailbox" }, 409);
  }
  if (await isMailboxUsernameTaken(db, username, settings.domain)) {
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
  const nonceCheck = await ensureNewNonce(db, fingerprint, proofResult.record.nonce);
  if (!nonceCheck.ok) return json({ error: nonceCheck.error }, 400);

  const now = Date.now();
  try {
    await insertMailbox(db, {
      username,
      domain: settings.domain,
      fingerprint,
      stalwartId: null,
      createdAt: now,
    });
  } catch (e) {
    if (String(e).toUpperCase().includes("UNIQUE")) {
      return json({ error: "That address is taken." }, 409);
    }
    throw e;
  }

  let stalwartId: string;
  try {
    stalwartId = await stalwart.createUser({
      name: username,
      domain: settings.domain,
      password: mailPassword,
      quotaBytes: settings.quotaBytes,
      description: fingerprint,
    });
  } catch (err) {
    await deleteMailbox(db, username, settings.domain);
    if (err instanceof StalwartError && err.code === "already_exists") {
      return json({ error: "That address is taken." }, 409);
    }
    console.error("stalwart createUser failed:", err);
    return json({ error: "mail server could not create the mailbox" }, 502);
  }

  try {
    await setMailboxStalwartId(db, username, settings.domain, stalwartId);
    const createdAt = proofResult.record.timestamp ?? now;
    if (existingEmail) {
      await updateDetail(db, { fingerprint, path: "email", detail: email, proof: detailProof, createdAt });
    } else {
      await insertDetail(db, { fingerprint, path: "email", detail: email, proof: detailProof, createdAt });
    }
    await markDetailVerified(db, fingerprint, "email", now);
  } catch (err) {
    console.error("mailbox signup rollback:", err);
    await stalwart.destroyUser(stalwartId).catch((e) =>
      console.error("stalwart rollback failed:", e)
    );
    await deleteMailbox(db, username, settings.domain);
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
      error: `mailPassword must be ${MAIL_PASSWORD_MIN}-${MAIL_PASSWORD_MAX} characters`,
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
  const expectedDetail = buildMailPasswordResetDetail(email, sha256Hex(mailPassword));
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
