import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes } from "./Base64.ts";
import type { EncryptionKeyOptions, SigningKeyOptions } from "./Keys.ts";
import { bech32 } from "bech32";
import { toHex, concatBytes } from "./Hex.ts";

const textEncoder = new TextEncoder();

export type IdentityFingerprintInput = {
  signingKeyType: SigningKeyOptions;
  encryptionKeyType: EncryptionKeyOptions;
  signingKey: string;
  encryptionKey: string;
};

export const FINGERPRINT_BYTE_LENGTH = 32;
export const FINGERPRINT_HRPS = ["ebpdk", "ebpsk"] as const;

function getFingerprintHrp(signingKeyType: SigningKeyOptions, encryptionKeyType: EncryptionKeyOptions): string {
  if (encryptionKeyType !== "kyber") {
    throw new Error(`Unsupported encryption key type: ${encryptionKeyType}`);
  }
  switch (signingKeyType) {
    case "dilithium":
      return "ebpdk";
    case "sphincs":
      return "ebpsk";
    default:
      throw new Error(`Unsupported signing key type: ${signingKeyType}`);
  }
}

export function computeSigningLeafRaw(
  _type: SigningKeyOptions,
  signingPublicKey: string,
): Uint8Array {
  return sha256(base64ToBytes(signingPublicKey));
}

export function computeEncryptionLeafRaw(
  _type: EncryptionKeyOptions,
  encryptionPublicKey: string,
): Uint8Array {
  // Keep compatibility with current Kyber fingerprint behavior: hash the
  // hex-string bytes rather than decoding hex to raw bytes.
  return sha256(textEncoder.encode(encryptionPublicKey));
}

export function computeIdentityMerkleRootRaw(input: IdentityFingerprintInput): Uint8Array {
  const leftLeaf = computeSigningLeafRaw(input.signingKeyType, input.signingKey);
  const rightLeaf = computeEncryptionLeafRaw(input.encryptionKeyType, input.encryptionKey);
  return sha256(concatBytes(leftLeaf, rightLeaf));
}

export function computeIdentityFingerprintHex(input: IdentityFingerprintInput): string {
  return toHex(computeIdentityMerkleRootRaw(input));
}

export function encodeFingerprintBech32(rawFingerprint: Uint8Array, hrp: string): string {
  if (rawFingerprint.length !== FINGERPRINT_BYTE_LENGTH) {
    throw new Error(`Fingerprint must be ${FINGERPRINT_BYTE_LENGTH} bytes`);
  }
  return bech32.encode(hrp, bech32.toWords(rawFingerprint));
}

export function decodeFingerprintBech32(
  fingerprint: string,
): { hrp: string; bytes: Uint8Array } {
  if (fingerprint !== fingerprint.toLowerCase()) {
    throw new Error("Fingerprint must be lowercase bech32");
  }
  const decoded = bech32.decode(fingerprint);
  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  if (bytes.length !== FINGERPRINT_BYTE_LENGTH) {
    throw new Error(`Fingerprint payload must be ${FINGERPRINT_BYTE_LENGTH} bytes`);
  }
  return { hrp: decoded.prefix, bytes };
}

export function isValidFingerprintBech32(fingerprint: string): boolean {
  try {
    const decoded = decodeFingerprintBech32(fingerprint);
    return FINGERPRINT_HRPS.includes(decoded.hrp as (typeof FINGERPRINT_HRPS)[number]);
  } catch {
    return false;
  }
}

export function computeIdentityFingerprint(input: IdentityFingerprintInput): string {
  const root = computeIdentityMerkleRootRaw(input);
  const hrp = getFingerprintHrp(input.signingKeyType, input.encryptionKeyType);
  return encodeFingerprintBech32(root, hrp);
}

