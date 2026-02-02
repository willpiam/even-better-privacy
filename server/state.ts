import type { DetailsMap, IdentityRow, IdentityState } from "./types.ts";

export function buildState(identity: IdentityRow, details: DetailsMap): IdentityState {
  return {
    fingerprint: identity.fingerprint,
    signingKeyType: identity.signing_key_type,
    encryptionKeyType: identity.encryption_key_type,
    signingKey: identity.signing_key,
    encryptionKey: identity.encryption_key,
    signingKeyDetails: identity.signing_key_details,
    encryptionKeyDetails: identity.encryption_key_details,
    details,
  };
}

