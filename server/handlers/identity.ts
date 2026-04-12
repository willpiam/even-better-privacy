import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { buildMessageHashEnvelopeFromHash, sha256Hex } from "../../core/MessageHash.ts";
import { readJsonBody, validateStringLength, LIMITS } from "../body.ts";
import { json } from "../response.ts";
import {
  ensureNewNonce,
  getDetailRecord,
  getDetailsMap,
  getDetailsMetaMap,
  getIdentity,
  getRevokedDetailPaths,
  insertDetail,
  insertIdentity,
  isIdentityRevoked,
  updateDetail,
  updateDetailVerification,
} from "../db.ts";
import type { DatabaseAdapter } from "../db.ts";
import {
  computeIdentityFingerprint,
  computeSigningRawFingerprint,
  computeStateHash,
  computeTokenHash,
  stableStringify,
} from "../crypto.ts";
import { verifyDetailProof } from "../detail.ts";
import { buildState } from "../state.ts";
import type { DetailPayload } from "../types.ts";
import {
  EMAIL_VERIFICATION_STORE_PLAINTEXT,
  EMAIL_VERIFICATION_TTL_MS,
  generateVerificationToken,
  getPublicBaseUrl,
  sendVerificationEmail,
} from "../verify-email.ts";

export async function handlePostIdentity(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const signingKeyType = payload.signingKeyType;
  const encryptionKeyType = payload.encryptionKeyType;

  if (signingKeyType !== "dilithium" && signingKeyType !== "sphincs") {
    return json({ error: "unsupported signingKeyType" }, 400);
  }
  if (encryptionKeyType !== "kyber") {
    return json({ error: "unsupported encryptionKeyType" }, 400);
  }

  const signingKeyCheck = validateStringLength(payload.signingKey, "signingKey", LIMITS.signingKey);
  if (!signingKeyCheck.ok) return json({ error: signingKeyCheck.error }, 400);
  const signingKey = signingKeyCheck.value;

  const encryptionKeyCheck = validateStringLength(payload.encryptionKey, "encryptionKey", LIMITS.encryptionKey);
  if (!encryptionKeyCheck.ok) return json({ error: encryptionKeyCheck.error }, 400);
  const encryptionKey = encryptionKeyCheck.value;

  const toStateCheck = validateStringLength(payload.toState, "toState", LIMITS.stateHash);
  if (!toStateCheck.ok) return json({ error: toStateCheck.error }, 400);
  const toState = toStateCheck.value;

  const stateSignatureCheck = validateStringLength(payload.stateSignature, "stateSignature", LIMITS.stateSignature);
  if (!stateSignatureCheck.ok) return json({ error: stateSignatureCheck.error }, 400);
  const stateSignature = stateSignatureCheck.value;

  const fromStateCheck = validateStringLength(payload.fromState, "fromState", LIMITS.stateHash, false);
  if (!fromStateCheck.ok) return json({ error: fromStateCheck.error }, 400);
  const fromState = fromStateCheck.value || null;

  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint, false);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const providedFingerprint = fingerprintCheck.value || undefined;
  if (providedFingerprint && !isValidFingerprintBech32(providedFingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const signingKeyDetails = payload.signingKeyDetails as Record<string, unknown> | undefined;
  const encryptionKeyDetails = payload.encryptionKeyDetails as Record<string, unknown> | undefined;

  try {
    computeSigningRawFingerprint(signingKeyType, signingKey);
  } catch {
    return json({ error: "invalid signingKey" }, 400);
  }

  let fingerprint: string;
  try {
    fingerprint = computeIdentityFingerprint({
      signingKeyType,
      encryptionKeyType,
      signingKey,
      encryptionKey,
    });
  } catch {
    return json({ error: "failed to compute fingerprint" }, 400);
  }

  if (providedFingerprint && providedFingerprint !== fingerprint) {
    return json({ error: "fingerprint mismatch" }, 400);
  }

  const existing = await getIdentity(db, fingerprint);
  const currentDetails = await getDetailsMap(db, fingerprint);
  const currentState = existing
    ? buildState(existing, currentDetails)
    : undefined;

  if (existing) {
    if (
      existing.signing_key_type !== signingKeyType ||
      existing.encryption_key_type !== encryptionKeyType ||
      existing.signing_key !== signingKey ||
      existing.encryption_key !== encryptionKey
    ) {
      return json({ error: "identity keys differ from existing record" }, 400);
    }
  }

  const targetState = buildState({
    fingerprint,
    signing_key_type: signingKeyType,
    encryption_key_type: encryptionKeyType,
    signing_key: signingKey,
    encryption_key: encryptionKey,
    signing_key_details: signingKeyDetails ?? null,
    encryption_key_details: encryptionKeyDetails ?? null,
    created_at: existing?.created_at ?? Date.now(),
  }, existing ? currentDetails : {});

  const expectedToState = computeStateHash(targetState);
  if (toState !== expectedToState) {
    return json({ error: "toState mismatch" }, 400);
  }

  const expectedFromState = currentState ? computeStateHash(currentState) : null;
  if (expectedFromState !== fromState) {
    return json({ error: "fromState mismatch" }, 400);
  }

  const variant =
    (existing?.signing_key_details as { variant?: string } | null)?.variant ??
    signingKeyDetails?.variant;
  if (!variant || typeof variant !== "string") {
    return json({ error: "missing signing variant" }, 400);
  }

  const transitionMessage = stableStringify({ fromState, toState });
  const transitionEnvelope = buildMessageHashEnvelopeFromHash(sha256Hex(transitionMessage), "");
  let verified = false;
  try {
    if (signingKeyType === "dilithium") {
      verified = DilithiumSigningKey.verify(variant, transitionEnvelope, stateSignature, signingKey);
    } else {
      verified = SphincsSigningKey.verify(variant, transitionEnvelope, stateSignature, signingKey);
    }
  } catch {
    return json({ error: "failed to verify stateSignature" }, 400);
  }
  if (!verified) {
    return json({ error: "invalid stateSignature" }, 400);
  }

  if (existing) {
    return json({ fingerprint });
  }

  await insertIdentity(db, {
    fingerprint,
    signingKeyType,
    encryptionKeyType,
    signingKey,
    encryptionKey,
    signingKeyDetails: signingKeyDetails ?? null,
    encryptionKeyDetails: encryptionKeyDetails ?? null,
    createdAt: Date.now(),
  });

  return json({ fingerprint });
}

export async function handleGetIdentity(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const details = await getDetailsMap(db, fingerprint);
  const detailsMeta = await getDetailsMetaMap(db, fingerprint);
  const revoked = await isIdentityRevoked(db, fingerprint);
  const revokedDetailPaths = await getRevokedDetailPaths(db, fingerprint);

  return json({
    fingerprint,
    signingKeyType: identity.signing_key_type,
    encryptionKeyType: identity.encryption_key_type,
    signingKey: identity.signing_key,
    encryptionKey: identity.encryption_key,
    signingKeyDetails: identity.signing_key_details,
    encryptionKeyDetails: identity.encryption_key_details,
    details,
    detailsMeta,
    revoked,
    revocationCertificate: identity.revocation_certificate ?? undefined,
    revokedDetails: revokedDetailPaths,
  });
}

export async function handlePostDetail(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<DetailPayload>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const fingerprintCheck = validateStringLength(payload.fingerprint, "fingerprint", LIMITS.fingerprint);
  if (!fingerprintCheck.ok) return json({ error: fingerprintCheck.error }, 400);
  const fingerprint = fingerprintCheck.value;
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const pathCheck = validateStringLength(payload.path, "path", LIMITS.path);
  if (!pathCheck.ok) return json({ error: pathCheck.error }, 400);
  const path = pathCheck.value;

  const detailCheck = validateStringLength(payload.detail, "detail", LIMITS.detail, false);
  if (!detailCheck.ok) return json({ error: detailCheck.error }, 400);
  const detail = detailCheck.value;
  if (path === "email" && detail.length === 0) {
    return json({ error: "email detail cannot be empty" }, 400);
  }

  const proofLengthCheck = validateStringLength(payload.proof, "proof", LIMITS.proof);
  if (!proofLengthCheck.ok) return json({ error: proofLengthCheck.error }, 400);
  const proof = proofLengthCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  const existingDetail = await getDetailRecord(db, fingerprint, path);
  if (existingDetail && existingDetail.revoked_at === null) {
    return json({ error: "detail already exists for path" }, 409);
  }

  const proofVerifyResult = verifyDetailProof(identity, path, detail, proof);
  if (!proofVerifyResult.ok) {
    return json({ error: proofVerifyResult.error ?? "invalid proof" }, 400);
  }

  const nonceCheck = await ensureNewNonce(db, fingerprint, proofVerifyResult.record.nonce);
  if (!nonceCheck.ok) {
    return json({ error: nonceCheck.error }, 400);
  }

  try {
    const createdAt = proofVerifyResult.record.timestamp ?? Date.now();
    if (existingDetail && existingDetail.revoked_at !== null) {
      await updateDetail(db, { fingerprint, path, detail, proof, createdAt });
    } else {
      await insertDetail(db, { fingerprint, path, detail, proof, createdAt });
    }

    if (path === "email") {
      const token = generateVerificationToken();
      const tokenHash = computeTokenHash(token);
      const now = Date.now();
      await updateDetailVerification(db, {
        fingerprint,
        path,
        verifiedAt: null,
        verificationToken: EMAIL_VERIFICATION_STORE_PLAINTEXT ? token : null,
        verificationTokenHash: tokenHash,
        verificationExpiresAt: now + EMAIL_VERIFICATION_TTL_MS,
        verificationSentAt: now,
      });

      const baseUrl = getPublicBaseUrl(req);
      if (!baseUrl) {
        console.warn("public base URL not configured; skipping verification email");
        return json({ ok: true, warning: "verification_email_not_sent" });
      }

      const link = `${baseUrl}/api/v1/verify-email?token=${encodeURIComponent(token)}`;
      sendVerificationEmail(detail, link, fingerprint).catch((err) => {
        console.error("failed to send verification email:", err);
      });
    }
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return json({ error: "detail already exists for path" }, 409);
    }
    console.error(e);
    return json({ error: "failed to store detail" }, 500);
  }

  return json({ ok: true });
}
