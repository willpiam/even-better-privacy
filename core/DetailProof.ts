import { Buffer } from "node:buffer";
import { DilithiumSigningKey } from "./Dilithium.ts";
import { SphincsSigningKey } from "./Sphincs.ts";
import { buildMessageHashEnvelope } from "./MessageHash.ts";

export type DetailProofRecord = {
  nonce: number;
  path: string;
  detail: string;
  timestamp: number;
  signature: string | null;
};

export function verifyDetailProof(input: {
  signingKeyType: "dilithium" | "sphincs";
  signingKey: string;
  signingVariant: string;
  path: string;
  detail: string;
  proof: string;
}): { ok: true; record: { nonce: number; timestamp: number } } | { ok: false; error?: string } {
  let record: DetailProofRecord;
  try {
    record = JSON.parse(Buffer.from(input.proof, "hex").toString());
  } catch {
    return { ok: false, error: "invalid proof encoding" };
  }

  if (record.path !== input.path || record.detail !== input.detail) {
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
  const envelope = buildMessageHashEnvelope(signedPayload);

  let verified = false;
  try {
    if (input.signingKeyType === "dilithium") {
      verified = DilithiumSigningKey.verify(input.signingVariant, envelope, record.signature, input.signingKey);
    } else {
      verified = SphincsSigningKey.verify(input.signingVariant, envelope, record.signature, input.signingKey);
    }
  } catch {
    return { ok: false, error: "failed to verify signature" };
  }

  if (!verified) {
    return { ok: false, error: "invalid signature" };
  }

  return { ok: true, record: { nonce: record.nonce, timestamp: record.timestamp } };
}
