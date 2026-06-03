import type { ExternalIdentity } from "./ExternalIdentity.ts";
import { computeExternalFingerprint } from "./Fingerprint.ts";

export type ResolveSenderIdentityParams = {
  senderHint?: string;
  senderFingerprint?: string;
  embeddedIdentity?: Record<string, unknown>;
  loadContact: (hint: string) => Promise<ExternalIdentity>;
  fetchFromServer?: (fingerprint: string) => Promise<ExternalIdentity | null>;
};

export type ResolveSenderIdentityResult = {
  contact: ExternalIdentity;
  isKnownContact: boolean;
};

export function externalIdentityFromEmbeddedRecord(
  record: Record<string, unknown>,
  expectedSenderFingerprint?: string,
): ExternalIdentity | null {
  const signingKey = typeof record.signingKey === "string"
    ? record.signingKey
    : undefined;
  const encryptionKey = typeof record.encryptionKey === "string"
    ? record.encryptionKey
    : undefined;
  if (!signingKey || !encryptionKey) {
    return null;
  }

  const signingKeyType = record.signingKeyType === "sphincs"
    ? "sphincs" as const
    : "dilithium" as const;
  const ext: ExternalIdentity = {
    fingerprint: typeof record.fingerprint === "string" ? record.fingerprint : "",
    signingKeyType,
    encryptionKeyType: "kyber",
    signingKey,
    encryptionKey,
    signingKeyDetails: (record.signingKeyDetails as ExternalIdentity[
      "signingKeyDetails"
    ]) ?? {
      variant: signingKeyType === "sphincs" ? "slh_dsa_sha2_256s" : "ml_dsa87",
    },
    encryptionKeyDetails: (record.encryptionKeyDetails as ExternalIdentity[
      "encryptionKeyDetails"
    ]) ?? { variant: "ml_kem1024" },
    details: (record.details as ExternalIdentity["details"]) ?? {},
    detailsMeta: (record.detailsMeta as ExternalIdentity["detailsMeta"]) ?? {},
  };

  const computed = computeExternalFingerprint(ext);
  if (!computed) {
    return null;
  }
  if (expectedSenderFingerprint && computed !== expectedSenderFingerprint) {
    return null;
  }
  ext.fingerprint = computed;
  return ext;
}

/**
 * Resolve a sender public identity for verify/decrypt flows.
 * Order: local contact (by hint) → server (by fingerprint) → embedded keys.
 */
export async function tryResolveSenderIdentity(
  params: ResolveSenderIdentityParams,
): Promise<ResolveSenderIdentityResult | null> {
  const senderHint = params.senderHint?.trim();
  const senderFp = params.senderFingerprint?.trim();
  const fetchFromServer = params.fetchFromServer;
  const embedded = params.embeddedIdentity
    ? externalIdentityFromEmbeddedRecord(
      params.embeddedIdentity,
      senderFp || undefined,
    )
    : null;

  if (senderHint) {
    try {
      const contact = await params.loadContact(senderHint);
      return { contact, isKnownContact: true };
    } catch {
      if (senderFp && fetchFromServer) {
        const fromServer = await fetchFromServer(senderFp);
        if (fromServer) {
          return { contact: fromServer, isKnownContact: false };
        }
      }
      if (embedded) {
        return { contact: embedded, isKnownContact: false };
      }
      return null;
    }
  }

  if (senderFp) {
    try {
      const contact = await params.loadContact(senderFp.substring(0, 16));
      return { contact, isKnownContact: true };
    } catch {
      if (fetchFromServer) {
        const fromServer = await fetchFromServer(senderFp);
        if (fromServer) {
          return { contact: fromServer, isKnownContact: false };
        }
      }
      if (embedded) {
        return { contact: embedded, isKnownContact: false };
      }
      return null;
    }
  }

  if (embedded) {
    return { contact: embedded, isKnownContact: false };
  }

  return null;
}

export async function resolveSenderIdentity(
  params: ResolveSenderIdentityParams,
): Promise<ResolveSenderIdentityResult> {
  const resolved = await tryResolveSenderIdentity(params);
  if (resolved) {
    return resolved;
  }
  if (params.senderHint) {
    throw new Error("Sender not found");
  }
  if (params.senderFingerprint) {
    throw new Error("Sender is required for signed messages");
  }
  throw new Error("Sender is required for signed payloads");
}
