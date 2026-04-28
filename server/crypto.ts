import { sha256 } from "@noble/hashes/sha2";
import {
  computeEncryptionLeafRaw,
  computeIdentityFingerprint as computeIdentityFingerprintBech32,
  computeIdentityMerkleRootRaw,
  computeSigningLeafRaw,
} from "../core/Fingerprint.ts";
import { hexToBytes, toHex } from "../core/Hex.ts";
export {
  canonicalize,
  computeStateHash,
  stableStringify,
} from "../core/StateHash.ts";

const textEncoder = new TextEncoder();

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export { hexToBytes, toHex };

export function computeSigningRawFingerprint(
  _type: "dilithium" | "sphincs",
  publicKey: string,
): Uint8Array {
  return computeSigningLeafRaw(_type, publicKey);
}

export function validatePostQuantumSigningKey(
  type: "dilithium" | "sphincs",
  publicKey: string,
): boolean {
  try {
    computeSigningRawFingerprint(type, publicKey);
    return true;
  } catch {
    return false;
  }
}

export function computeEncryptionRawFingerprint(
  encryptionKey: string,
): Uint8Array {
  return computeEncryptionLeafRaw("kyber", encryptionKey);
}

export function computeIdentityFingerprint(input: {
  signingKeyType: "dilithium" | "sphincs";
  encryptionKeyType: "kyber";
  signingKey: string;
  encryptionKey: string;
}): string {
  return computeIdentityFingerprintBech32(input);
}

export function computeIdentityMerkleRoot(input: {
  signingKeyType: "dilithium" | "sphincs";
  encryptionKeyType: "kyber";
  signingKey: string;
  encryptionKey: string;
}): Uint8Array {
  return computeIdentityMerkleRootRaw(input);
}

export function computeTokenHash(token: string): string {
  const data = textEncoder.encode(token);
  return toHex(sha256(data));
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  const left = textEncoder.encode(a);
  const right = textEncoder.encode(b);
  const maxLength = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < maxLength; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }

  return diff === 0;
}
