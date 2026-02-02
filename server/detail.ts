import { DilithiumSigningKey } from "../core/Dilithium.ts";
import { SphincsSigningKey } from "../core/Sphincs.ts";
import { hexToBytes } from "./crypto.ts";
import type { IdentityRow } from "./types.ts";

const textDecoder = new TextDecoder();

type DetailProofRecord = {
  nonce: number;
  path: string;
  detail: string;
  timestamp: number;
  signature: string | null;
};

export function verifyDetailProof(
  identity: IdentityRow,
  path: string,
  detail: string,
  proof: string,
): { ok: true; record: { nonce: number; timestamp: number } } | { ok: false; error?: string } {
  let record: DetailProofRecord;
  try {
    const decoded = hexToBytes(proof);
    record = JSON.parse(textDecoder.decode(decoded));
  } catch {
    return { ok: false, error: "invalid proof encoding" };
  }

  if (record.path !== path || record.detail !== detail) {
    return { ok: false, error: "proof mismatch" };
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

  const signedPayload = JSON.stringify({
    nonce: record.nonce,
    path: record.path,
    detail: record.detail,
    timestamp: record.timestamp,
    signature: null,
  });

  const variant = (identity.signing_key_details as { variant?: string } | null)?.variant;
  if (!variant) {
    return { ok: false, error: "missing signing variant" };
  }

  let verified = false;
  try {
    if (identity.signing_key_type === "dilithium") {
      verified = DilithiumSigningKey.verify(variant, signedPayload, record.signature, identity.signing_key);
    } else {
      verified = SphincsSigningKey.verify(variant, signedPayload, record.signature, identity.signing_key);
    }
  } catch {
    return { ok: false, error: "failed to verify signature" };
  }

  if (!verified) {
    return { ok: false, error: "invalid signature" };
  }

  return { ok: true, record: { nonce: record.nonce, timestamp: record.timestamp } };
}

