import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes } from "../core/Base64.ts";
import type { IdentityState } from "./types.ts";

const textEncoder = new TextEncoder();

export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

export function computeSigningRawFingerprint(_type: "dilithium" | "sphincs", publicKey: string): Uint8Array {
  const bytes = base64ToBytes(publicKey);
  return sha256(bytes);
}

export function computeEncryptionRawFingerprint(encryptionKey: string): Uint8Array {
  // Kyber public key is hex-encoded string; the existing implementation hashes the string bytes.
  return sha256(textEncoder.encode(encryptionKey));
}

export function computeIdentityFingerprint(input: {
  signingKeyType: "dilithium" | "sphincs";
  encryptionKeyType: "kyber";
  signingKey: string;
  encryptionKey: string;
}): string {
  const signingRaw = computeSigningRawFingerprint(input.signingKeyType, input.signingKey);
  const encryptionRaw = computeEncryptionRawFingerprint(input.encryptionKey);
  const combined = concatBytes(signingRaw, encryptionRaw);
  return toHex(sha256(combined));
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function computeStateHash(state: IdentityState): string {
  const canonical = canonicalize(state);
  const data = textEncoder.encode(JSON.stringify(canonical));
  return toHex(sha256(data));
}

