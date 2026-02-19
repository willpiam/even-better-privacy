import { DilithiumSigningKey } from "../core/Dilithium.ts";
import { SphincsSigningKey } from "../core/Sphincs.ts";
import { buildMessageHashEnvelope } from "../core/MessageHash.ts";
import { hexToBytes } from "./crypto.ts";
import type { IdentityRow } from "./types.ts";

const textDecoder = new TextDecoder();

export type RevocationCertificateRecord = {
  type: "detail" | "identity";
  fingerprint: string;
  nonce: number;
  timestamp: number;
  reason?: string;
  target?: string;
  signature: string;
};

export function verifyRevocationCertificate(
  identity: IdentityRow,
  encodedCertificate: string,
  expectedType: "detail" | "identity",
  expectedTarget?: string,
): { ok: true; record: RevocationCertificateRecord } | { ok: false; error?: string } {
  let record: RevocationCertificateRecord;
  try {
    const decoded = hexToBytes(encodedCertificate);
    record = JSON.parse(textDecoder.decode(decoded));
  } catch {
    return { ok: false, error: "invalid certificate encoding" };
  }

  // Validate structure
  if (record.type !== expectedType) {
    return { ok: false, error: `expected ${expectedType} revocation, got ${record.type}` };
  }

  if (record.fingerprint !== identity.fingerprint) {
    return { ok: false, error: "certificate fingerprint mismatch" };
  }

  if (expectedType === "detail") {
    if (typeof record.target !== "string" || record.target.length === 0) {
      return { ok: false, error: "detail revocation must specify target path" };
    }
    if (expectedTarget && record.target !== expectedTarget) {
      return { ok: false, error: "certificate target path mismatch" };
    }
  }

  if (typeof record.nonce !== "number" || !Number.isInteger(record.nonce) || record.nonce < 0) {
    return { ok: false, error: "invalid nonce" };
  }

  if (typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp)) {
    return { ok: false, error: "invalid timestamp" };
  }

  if (typeof record.signature !== "string" || record.signature.length === 0) {
    return { ok: false, error: "missing signature" };
  }

  // Reconstruct the payload that was signed (with signature=null)
  const signedPayload = JSON.stringify({
    type: record.type,
    fingerprint: record.fingerprint,
    nonce: record.nonce,
    timestamp: record.timestamp,
    reason: record.reason,
    target: record.target,
    signature: null,
  });
  const envelope = buildMessageHashEnvelope(signedPayload);

  const variant = (identity.signing_key_details as { variant?: string } | null)?.variant;
  if (!variant) {
    return { ok: false, error: "missing signing variant" };
  }

  let verified = false;
  try {
    if (identity.signing_key_type === "dilithium") {
      verified = DilithiumSigningKey.verify(variant, envelope, record.signature, identity.signing_key);
    } else {
      verified = SphincsSigningKey.verify(variant, envelope, record.signature, identity.signing_key);
    }
  } catch {
    return { ok: false, error: "failed to verify signature" };
  }

  if (!verified) {
    return { ok: false, error: "invalid signature" };
  }

  return { ok: true, record };
}


