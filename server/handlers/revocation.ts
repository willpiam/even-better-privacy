import { isValidFingerprintBech32 } from "../../core/Fingerprint.ts";
import { readJsonBody, validateStringLength, LIMITS } from "../body.ts";
import { json } from "../response.ts";
import {
  getIdentity,
  getMaxRevocationNonce,
  getRevocations,
  hasRevocationWithNonce,
  insertRevocation,
  isDetailRevoked,
  isIdentityRevoked,
  revokeDetail,
  revokeIdentity,
} from "../db.ts";
import type { DatabaseAdapter } from "../db.ts";
import { verifyRevocationCertificate } from "../revocation.ts";
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

  const maxNonce = await getMaxRevocationNonce(db, fingerprint);
  
  if (record.nonce === 0 && type === "identity") {
    if (await hasRevocationWithNonce(db, fingerprint, 0)) {
      return json({ error: "emergency revocation certificate already used" }, 400);
    }
  } else if (record.nonce <= maxNonce) {
    return json({ error: "revocation nonce must be greater than previous revocations" }, 400);
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
