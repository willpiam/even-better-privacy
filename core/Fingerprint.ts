import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes } from "./Base64.ts";
import type { EncryptionKeyOptions, SigningKeyOptions } from "./Keys.ts";
import { bech32 } from "bech32";
import { concatBytes, hexToBytes, toHex } from "./Hex.ts";

export type IdentityFingerprintInput = {
  signingKeyType: SigningKeyOptions;
  encryptionKeyType: EncryptionKeyOptions;
  signingKey?: string;
  signingKeyHash?: string;
  encryptionKey?: string;
  encryptionKeyHash?: string;
};

export const FINGERPRINT_BYTE_LENGTH = 32;
export const FINGERPRINT_HRPS = ["ebpdk", "ebpsk"] as const;

function parseLeafHashHex(hash: string, label: string): Uint8Array {
  const bytes = hexToBytes(hash);
  if (bytes.length !== FINGERPRINT_BYTE_LENGTH) {
    throw new Error(`${label} must be ${FINGERPRINT_BYTE_LENGTH} bytes`);
  }
  return bytes;
}

function getFingerprintHrp(
  signingKeyType: SigningKeyOptions,
  encryptionKeyType: EncryptionKeyOptions,
): string {
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
  return sha256(hexToBytes(encryptionPublicKey));
}

function resolveSigningLeafRaw(input: IdentityFingerprintInput): Uint8Array {
  const leaf = input.signingKey
    ? computeSigningLeafRaw(input.signingKeyType, input.signingKey)
    : null;
  const hash = input.signingKeyHash
    ? parseLeafHashHex(input.signingKeyHash, "signingKeyHash")
    : null;
  if (leaf && hash && toHex(leaf) !== toHex(hash)) {
    throw new Error("signingKeyHash does not match signingKey");
  }
  if (leaf) return leaf;
  if (hash) return hash;
  throw new Error("signingKey or signingKeyHash is required");
}

function resolveEncryptionLeafRaw(input: IdentityFingerprintInput): Uint8Array {
  const leaf = input.encryptionKey
    ? computeEncryptionLeafRaw(input.encryptionKeyType, input.encryptionKey)
    : null;
  const hash = input.encryptionKeyHash
    ? parseLeafHashHex(input.encryptionKeyHash, "encryptionKeyHash")
    : null;
  if (leaf && hash && toHex(leaf) !== toHex(hash)) {
    throw new Error("encryptionKeyHash does not match encryptionKey");
  }
  if (leaf) return leaf;
  if (hash) return hash;
  throw new Error("encryptionKey or encryptionKeyHash is required");
}

export function computeIdentityMerkleRootRaw(
  input: IdentityFingerprintInput,
): Uint8Array {
  const leftLeaf = resolveSigningLeafRaw(input);
  const rightLeaf = resolveEncryptionLeafRaw(input);
  return sha256(concatBytes(leftLeaf, rightLeaf));
}

export function computeIdentityFingerprintHex(
  input: IdentityFingerprintInput,
): string {
  return toHex(computeIdentityMerkleRootRaw(input));
}

export function encodeFingerprintBech32(
  rawFingerprint: Uint8Array,
  hrp: string,
): string {
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
    throw new Error(
      `Fingerprint payload must be ${FINGERPRINT_BYTE_LENGTH} bytes`,
    );
  }
  return { hrp: decoded.prefix, bytes };
}

export function isValidFingerprintBech32(fingerprint: string): boolean {
  try {
    const decoded = decodeFingerprintBech32(fingerprint);
    return FINGERPRINT_HRPS.includes(
      decoded.hrp as (typeof FINGERPRINT_HRPS)[number],
    );
  } catch {
    return false;
  }
}

export function computeIdentityFingerprint(
  input: IdentityFingerprintInput,
): string {
  const root = computeIdentityMerkleRootRaw(input);
  const hrp = getFingerprintHrp(input.signingKeyType, input.encryptionKeyType);
  return encodeFingerprintBech32(root, hrp);
}
