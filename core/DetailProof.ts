import { parseStrictJson } from "./StrictJson.ts";
import { DilithiumSigningKey } from "./Dilithium.ts";
import { SphincsSigningKey } from "./Sphincs.ts";
import { buildPurposeHashEnvelope } from "./MessageHash.ts";
import { hexToString } from "./Hex.ts";
import { canonicalJsonStringify } from "./CanonicalJson.ts";

export type DetailProofRecord = {
  version: number;
  nonce: number;
  path: string;
  detail: string;
  timestamp: number;
  signature: string | null;
};

export type DetailProofInput = { path: string; detail: string; proof: string };
export type DetailProofSigner = {
  signingKeyType: "dilithium" | "sphincs";
  signingKey: string;
  signingVariant: string;
};

type DetailProofResult =
  | { ok: true; record: DetailProofRecord & { signature: string } }
  | { ok: false; error: string };

/** Decode and validate structure only; this does not authenticate the signer. */
export function parseDetailProof(input: DetailProofInput): DetailProofResult {
  let record: DetailProofRecord;
  try {
    record = parseStrictJson(hexToString(input.proof));
  } catch {
    return { ok: false, error: "invalid proof encoding" };
  }

  if (
    !record || typeof record !== "object" || record.version !== 2 ||
    typeof record.path !== "string" || typeof record.detail !== "string" ||
    record.path !== input.path || record.detail !== input.detail
  ) {
    return { ok: false, error: "proof mismatch" };
  }

  if (
    typeof record.nonce !== "number" || !Number.isSafeInteger(record.nonce) ||
    record.nonce < 0
  ) {
    return { ok: false, error: "invalid nonce" };
  }

  if (
    typeof record.timestamp !== "number" ||
    !Number.isSafeInteger(record.timestamp)
  ) {
    return { ok: false, error: "invalid timestamp" };
  }

  if (typeof record.signature !== "string" || record.signature.length === 0) {
    return { ok: false, error: "missing signature" };
  }

  return {
    ok: true,
    record: record as DetailProofRecord & { signature: string },
  };
}

/** Validate a detail's structure and cryptographically authenticate its proof. */
export function verifyDetailProof(
  input: DetailProofInput & DetailProofSigner,
):
  | { ok: true; record: { nonce: number; timestamp: number } }
  | { ok: false; error: string } {
  const parsed = parseDetailProof(input);
  if (!parsed.ok) return parsed;
  const { record } = parsed;

  const signedPayload = canonicalJsonStringify({
    version: 2,
    nonce: record.nonce,
    path: record.path,
    detail: record.detail,
    timestamp: record.timestamp,
    signature: null,
  });
  const envelope = buildPurposeHashEnvelope("detail-proof", signedPayload);

  let verified = false;
  try {
    if (input.signingKeyType === "dilithium") {
      verified = DilithiumSigningKey.verify(
        input.signingVariant,
        envelope,
        record.signature,
        input.signingKey,
      );
    } else {
      verified = SphincsSigningKey.verify(
        input.signingVariant,
        envelope,
        record.signature,
        input.signingKey,
      );
    }
  } catch {
    return { ok: false, error: "failed to verify signature" };
  }

  if (!verified) {
    return { ok: false, error: "invalid signature" };
  }

  return {
    ok: true,
    record: { nonce: record.nonce, timestamp: record.timestamp },
  };
}

/** Nonces determine history order; wall-clock timestamps need not be monotonic. */
export function validateDetailHistoryStructure(
  details: Map<string, [string, string]>,
): boolean {
  const seenNonces = new Set<number>();
  for (const [path, [detail, proof]] of details) {
    const parsed = parseDetailProof({ path, detail, proof });
    if (!parsed.ok || seenNonces.has(parsed.record.nonce)) return false;
    seenNonces.add(parsed.record.nonce);
  }
  return true;
}
