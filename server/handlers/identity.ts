import { DilithiumSigningKey } from "../../core/Dilithium.ts";
import { SphincsSigningKey } from "../../core/Sphincs.ts";
import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { externalIdentityFromEmbeddedRecord } from "../../core/EmbeddedIdentity.ts";
import {
  buildMessageHashEnvelopeFromHash,
  sha256Hex,
} from "../../core/MessageHash.ts";
import { LIMITS, readJsonBody, validateStringLength } from "../body.ts";
import { json } from "../response.ts";
import {
  ensureNewNonce,
  consumeNonce,
  getDetailRecord,
  getDetailsMap,
  getIdentityDetailView,
  getDetailsMetaMap,
  getIdentity,
  getRevokedDetailPaths,
  insertDetail,
  insertIdentity,
  isIdentityRevoked,
  updateDetail,
} from "../db/index.ts";
import type { DatabaseAdapter } from "../db/index.ts";
import {
  computeIdentityFingerprint,
  computeStateHash,
  stableStringify,
  validatePostQuantumSigningKey,
} from "../crypto.ts";
import { verifyDetailProof } from "../detail.ts";
import { buildState } from "../state.ts";
import type { DetailPayload } from "../types.ts";
import {
  issueAndSendVerificationEmail,
  parseVerificationMailbox,
  prepareVerificationDelivery,
} from "../verify-email.ts";

function invalidIdentitySubmission(): Response {
  return json({ error: "invalid identity submission" }, 400);
}

export async function handlePostIdentity(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const bodyResult = await readJsonBody<Record<string, unknown>>(req);
  if (!bodyResult.ok) {
    return json({ error: bodyResult.error }, bodyResult.status);
  }
  const payload = bodyResult.data;

  const signingKeyType = payload.signingKeyType;
  const encryptionKeyType = payload.encryptionKeyType;

  if (signingKeyType !== "dilithium" && signingKeyType !== "sphincs") {
    return invalidIdentitySubmission();
  }
  if (encryptionKeyType !== "kyber") {
    return invalidIdentitySubmission();
  }

  const signingKeyCheck = validateStringLength(
    payload.signingKey,
    "signingKey",
    LIMITS.signingKey,
  );
  if (!signingKeyCheck.ok) return invalidIdentitySubmission();
  const signingKey = signingKeyCheck.value;

  const encryptionKeyCheck = validateStringLength(
    payload.encryptionKey,
    "encryptionKey",
    LIMITS.encryptionKey,
  );
  if (!encryptionKeyCheck.ok) {
    return invalidIdentitySubmission();
  }
  const encryptionKey = encryptionKeyCheck.value;

  const toStateCheck = validateStringLength(
    payload.toState,
    "toState",
    LIMITS.stateHash,
  );
  if (!toStateCheck.ok) return invalidIdentitySubmission();
  const toState = toStateCheck.value;

  const stateSignatureCheck = validateStringLength(
    payload.stateSignature,
    "stateSignature",
    LIMITS.stateSignature,
  );
  if (!stateSignatureCheck.ok) {
    return invalidIdentitySubmission();
  }
  const stateSignature = stateSignatureCheck.value;

  const fromStateCheck = validateStringLength(
    payload.fromState,
    "fromState",
    LIMITS.stateHash,
    false,
  );
  if (!fromStateCheck.ok) return invalidIdentitySubmission();
  const fromState = fromStateCheck.value || null;

  const fingerprintCheck = validateStringLength(
    payload.fingerprint,
    "fingerprint",
    LIMITS.fingerprint,
    false,
  );
  if (!fingerprintCheck.ok) return invalidIdentitySubmission();
  const providedFingerprint = fingerprintCheck.value || undefined;
  if (providedFingerprint && !isValidFingerprintBech32(providedFingerprint)) {
    return invalidIdentitySubmission();
  }

  const signingKeyDetails = payload.signingKeyDetails as
    | Record<string, unknown>
    | undefined;
  const encryptionKeyDetails = payload.encryptionKeyDetails as
    | Record<string, unknown>
    | undefined;

  if (!validatePostQuantumSigningKey(signingKeyType, signingKey)) {
    return invalidIdentitySubmission();
  }
  if (
    !externalIdentityFromEmbeddedRecord({
      signingKeyType,
      encryptionKeyType,
      signingKey,
      encryptionKey,
      signingKeyDetails,
      encryptionKeyDetails,
      ...(providedFingerprint ? { fingerprint: providedFingerprint } : {}),
    }, providedFingerprint)
  ) return invalidIdentitySubmission();

  let fingerprint: string;
  try {
    fingerprint = computeIdentityFingerprint({
      signingKeyType,
      encryptionKeyType,
      signingKey,
      encryptionKey,
    });
  } catch {
    return invalidIdentitySubmission();
  }

  if (providedFingerprint && providedFingerprint !== fingerprint) {
    return invalidIdentitySubmission();
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
      return invalidIdentitySubmission();
    }
    return json({ fingerprint });
  }

  const targetState = buildState({
    fingerprint,
    signing_key_type: signingKeyType,
    encryption_key_type: encryptionKeyType,
    signing_key: signingKey,
    encryption_key: encryptionKey,
    signing_key_details: signingKeyDetails ?? null,
    encryption_key_details: encryptionKeyDetails ?? null,
    created_at: Date.now(),
  }, existing ? currentDetails : {});

  const expectedToState = computeStateHash(targetState);
  if (toState !== expectedToState) {
    return invalidIdentitySubmission();
  }

  const expectedFromState = currentState
    ? computeStateHash(currentState)
    : null;
  if (expectedFromState !== fromState) {
    return invalidIdentitySubmission();
  }

  const variant = signingKeyDetails?.variant;
  if (!variant || typeof variant !== "string") {
    return invalidIdentitySubmission();
  }

  const transitionMessage = stableStringify({ fromState, toState });
  const transitionEnvelope = buildMessageHashEnvelopeFromHash(
    sha256Hex(transitionMessage),
    "",
  );
  let verified = false;
  try {
    if (signingKeyType === "dilithium") {
      verified = DilithiumSigningKey.verify(
        variant,
        transitionEnvelope,
        stateSignature,
        signingKey,
      );
    } else {
      verified = SphincsSigningKey.verify(
        variant,
        transitionEnvelope,
        stateSignature,
        signingKey,
      );
    }
  } catch {
    return invalidIdentitySubmission();
  }
  if (!verified) {
    return invalidIdentitySubmission();
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

export async function handleGetIdentity(
  fingerprint: string,
  db: DatabaseAdapter,
): Promise<Response> {
  if (fingerprint.length > LIMITS.fingerprint) {
    return json({ error: "fingerprint too long" }, 400);
  }
  if (!isValidFingerprintBech32(fingerprint)) {
    return json({ error: "fingerprint must be valid bech32" }, 400);
  }

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "unknown subject" }, 404);
  }

  const {details, detailsMeta, revokedDetails: revokedDetailPaths} = await getIdentityDetailView(db, fingerprint);
  const revoked = await isIdentityRevoked(db, fingerprint);

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

export async function handlePostDetail(
  req: Request,
  db: DatabaseAdapter,
): Promise<Response> {
  const bodyResult = await readJsonBody<DetailPayload>(req);
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

  const pathCheck = validateStringLength(payload.path, "path", LIMITS.path);
  if (!pathCheck.ok) return json({ error: pathCheck.error }, 400);
  const path = pathCheck.value;
  if (path.startsWith("ebp-mail::")) return json({error: "authorization paths cannot be published as details"}, 400);

  const detailCheck = validateStringLength(
    payload.detail,
    "detail",
    LIMITS.detail,
    false,
  );
  if (!detailCheck.ok) return json({ error: detailCheck.error }, 400);
  const detail = detailCheck.value;
  const mailbox = path === "email" ? parseVerificationMailbox(detail) : null;
  if (path === "email" && !mailbox) {
    return json({ error: "email must identify one mailbox" }, 400);
  }

  const proofLengthCheck = validateStringLength(
    payload.proof,
    "proof",
    LIMITS.proof,
  );
  if (!proofLengthCheck.ok) return json({ error: proofLengthCheck.error }, 400);
  const proof = proofLengthCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "unknown subject" }, 400);
  }
  const proofVerifyResult = verifyDetailProof(identity, path, detail, proof);
  if (!proofVerifyResult.ok) {
    return json({ error: proofVerifyResult.error ?? "invalid proof" }, 400);
  }

  const stored = await db.writeTransaction(async (db) => {
    if (await isIdentityRevoked(db, fingerprint)) {
      return json({ error: "identity is revoked" }, 400);
    }

    const existingDetail = await getDetailRecord(db, fingerprint, path);
    if (existingDetail && existingDetail.revoked_at === null) {
      return json({ error: "detail already exists for path" }, 409);
    }

    const nonceCheck = await consumeNonce(
      db,
      fingerprint,
      proofVerifyResult.record.nonce,
    );
    if (!nonceCheck.ok) return json({ error: nonceCheck.error }, 400);
    const createdAt = proofVerifyResult.record.timestamp;
    if (existingDetail) {
      await updateDetail(db, { fingerprint, path, detail, proof, createdAt });
    } else {
      await insertDetail(db, { fingerprint, path, detail, proof, createdAt });
    }
    return null;
  }, `identity:${fingerprint}`);
  if (stored) return stored;

  if (path === "email" && mailbox) {
    const delivery = prepareVerificationDelivery(req);
    if (!delivery) {
      return json({
        ok: true,
        verificationStatus: "delivery_unavailable",
        warning: "verification_email_not_sent",
      });
    }
    try {
      const verificationStatus = await issueAndSendVerificationEmail(
        db,
        { fingerprint, path, detail, proof },
        mailbox,
        delivery,
      );
      return json({ ok: true, fingerprint, path, verificationStatus });
    } catch {
      console.error("Verification email token could not be issued.");
      return json({
        ok: true,
        verificationStatus: "issuance_failed",
        warning: "verification_email_not_sent",
      });
    }
  }

  return json({ ok: true });
}
