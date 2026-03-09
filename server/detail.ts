import { verifyDetailProof as verifyDetailProofCore } from "../core/DetailProof.ts";
import type { IdentityRow } from "./types.ts";

export function verifyDetailProof(
  identity: IdentityRow,
  path: string,
  detail: string,
  proof: string,
): { ok: true; record: { nonce: number; timestamp: number } } | { ok: false; error?: string } {
  const variant = (identity.signing_key_details as { variant?: string } | null)?.variant;
  if (!variant) {
    return { ok: false, error: "missing signing variant" };
  }

  return verifyDetailProofCore({
    signingKeyType: identity.signing_key_type,
    signingKey: identity.signing_key,
    signingVariant: variant,
    path,
    detail,
    proof,
  });
}

