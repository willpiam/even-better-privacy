import { sha256 } from "@noble/hashes/sha2";
import type { ExternalIdentity } from "./ExternalIdentity.ts";
import type { EncryptionKeyOptions, SigningKeyOptions } from "./Keys.ts";
import { toHex } from "./Hex.ts";
import { canonicalize } from "./CanonicalJson.ts";

const textEncoder = new TextEncoder();

export type IdentityState = {
  fingerprint: string;
  signingKeyType: SigningKeyOptions | string;
  encryptionKeyType: EncryptionKeyOptions | string;
  signingKey: string;
  encryptionKey: string;
  signingKeyDetails?: Record<string, unknown> | null;
  encryptionKeyDetails?: Record<string, unknown> | null;
  details: Record<string, [string, string]>;
};

export { canonicalize, stableStringify } from "./CanonicalJson.ts";

export function computeStateHash(state: IdentityState): string {
  const canonical = canonicalize(state);
  const data = textEncoder.encode(JSON.stringify(canonical));
  return toHex(sha256(data));
}

export function buildIdentityStateFromExternal(
  ext: ExternalIdentity,
  details: Record<string, [string, string]>,
): IdentityState {
  return {
    fingerprint: ext.fingerprint,
    signingKeyType: ext.signingKeyType,
    encryptionKeyType: ext.encryptionKeyType,
    signingKey: ext.signingKey,
    encryptionKey: ext.encryptionKey,
    signingKeyDetails: ext.signingKeyDetails ?? null,
    encryptionKeyDetails: ext.encryptionKeyDetails ?? null,
    details,
  };
}
