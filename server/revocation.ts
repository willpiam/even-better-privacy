import { decodeAndVerifyRevocationCertificate } from "../core/Revocation.ts";
import type { IdentityRow } from "./types.ts";

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
  const variant = (identity.signing_key_details as { variant?: string } | null)?.variant;
  if (!variant) {
    return { ok: false, error: "missing signing variant" };
  }

  const result = decodeAndVerifyRevocationCertificate(encodedCertificate, {
    signingKeyType: identity.signing_key_type,
    signingKey: identity.signing_key,
    variant,
    expectedType,
    expectedTarget,
    expectedFingerprint: identity.fingerprint,
  });
  if (!result.ok) {
    return result;
  }

  return { ok: true, record: result.certificate };
}


