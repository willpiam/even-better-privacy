import type { ExternalIdentity } from "../core/ExternalIdentity.ts";
import { externalIdentityFromEmbeddedRecord } from "../core/EmbeddedIdentity.ts";
export { externalIdentityFromEmbeddedRecord } from "../core/EmbeddedIdentity.ts";

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
