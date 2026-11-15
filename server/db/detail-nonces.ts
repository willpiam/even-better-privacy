import { hexToString } from "../../core/Hex.ts";

/** Read the ordering field from a proof already authenticated at the API boundary. */
export function detailProofNonce(proof: string): number | null {
  try {
    const nonce = JSON.parse(hexToString(proof))?.nonce;
    return typeof nonce === "number" && Number.isSafeInteger(nonce) &&
        nonce >= 0
      ? nonce
      : null;
  } catch {
    return null;
  }
}
