import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { readJsonBody, validateStringLength, LIMITS } from "../body.ts";
import { json } from "../response.ts";
import {
  getIdentity,
  getMaxRevocationNonceBelow,
  getRevocations,
  hasRevocationWithNonce,
  insertRevocation,
  isDetailRevoked,
  isIdentityRevoked,
  revokeDetail,
  revokeIdentity,
} from "../db/index.ts";
import type { DatabaseAdapter } from "../db/index.ts";
import { verifyRevocationCertificate } from "../revocation.ts";
import { EMERGENCY_NONCE_BASE, isEmergencyNonce } from "../../core/Revocation.ts";
import type { RevocationPayload } from "../types.ts";

export async function handlePostRevocation(req: Request, db: DatabaseAdapter): Promise<Response> {
  const bodyResult = await readJsonBody<RevocationPayload>(req);
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

  const type = payload.type;
  if (type !== "detail" && type !== "identity") {
    return json({ error: "invalid revocation type (must be 'detail' or 'identity')" }, 400);
  }

  const targetCheck = validateStringLength(payload.target, "target", LIMITS.path, type === "detail");
  if (!targetCheck.ok) return json({ error: targetCheck.error }, 400);
  const target = targetCheck.value || undefined;

  if (type === "detail" && !target) {
    return json({ error: "detail revocation requires target path" }, 400);
  }

  const certificateCheck = validateStringLength(payload.certificate, "certificate", LIMITS.certificate);
  if (!certificateCheck.ok) return json({ error: certificateCheck.error }, 400);
  const certificate = certificateCheck.value;

  const identity = await getIdentity(db, fingerprint);
  if (!identity) {
    return json({ error: "identity not found" }, 404);
  }

  if (type === "identity" && await isIdentityRevoked(db, fingerprint)) {
    return json({ error: "identity is already revoked" }, 409);
  }

  if (type === "detail" && await isDetailRevoked(db, fingerprint, target!)) {
    return json({ error: "detail is already revoked" }, 409);
  }

  const verifyResult = verifyRevocationCertificate(identity, certificate, type, target);
  if (!verifyResult.ok) {
    return json({ error: verifyResult.error ?? "invalid certificate" }, 400);
  }

  const record = verifyResult.record;

  // F-CRYPTO-01: emergency certificates live in a separate nonce space
  // (EMERGENCY_NONCE_BASE and above) so they are not silently consumed by
  // a regular revocation issued first. Track max regular and max emergency
  // nonces independently.
  const isEmergency = isEmergencyNonce(record.nonce);

  if (isEmergency) {
    if (type !== "identity") {
      return json({ error: "emergency nonce is reserved for identity revocations" }, 400);
    }
    // Emergency cert: must be unique within the emergency nonce space.
    if (await hasRevocationWithNonce(db, fingerprint, record.nonce)) {
      return json({ error: "emergency revocation certificate already used" }, 400);
    }
  } else {
    // Regular revocation must not accidentally use the emergency space.
    if (record.nonce >= EMERGENCY_NONCE_BASE) {
      return json({ error: "nonce is in reserved emergency range" }, 400);
    }
    // Monotonicity only against other regular revocations.
    const maxRegular = await getMaxRevocationNonceBelow(db, fingerprint, EMERGENCY_NONCE_BASE);
    if (record.nonce <= maxRegular) {
      return json({ error: "revocation nonce must be greater than previous revocations" }, 400);
    }
  }

  const now = Date.now();
  await insertRevocation(db, {
    fingerprint,
    type,
    target: target ?? null,
    nonce: record.nonce,
    certificate,
    createdAt: now,
  });

  if (type === "identity") {
    await revokeIdentity(db, fingerprint, certificate, now);
  } else {
    await revokeDetail(db, fingerprint, target!, certificate, now);
  }

  return json({ ok: true, type, target: target ?? undefined });
}

export async function handleGetRevocations(fingerprint: string, db: DatabaseAdapter): Promise<Response> {
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

  const revocations = await getRevocations(db, fingerprint);
  
  return json({
    fingerprint,
    revoked: await isIdentityRevoked(db, fingerprint),
    revocationCertificate: identity.revocation_certificate ?? undefined,
    revocations: revocations.map(r => ({
      type: r.type,
      target: r.target,
      nonce: r.nonce,
      certificate: r.certificate,
      createdAt: r.created_at,
    })),
  });
}
