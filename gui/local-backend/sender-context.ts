import { apiUrl, type CLIContext } from "../../cli/utils.ts";
import type { ExternalIdentity } from "../../core/Identity.ts";
import {
  tryResolveSenderIdentity,
} from "../../core/SenderResolution.ts";
import { loadContact } from "./contacts.ts";

export async function tryResolveSenderForCtx(
  ctx: CLIContext,
  params: {
    senderHint?: string;
    senderFingerprint?: string;
    embeddedIdentity?: Record<string, unknown>;
  },
): Promise<{ contact: ExternalIdentity; isKnownContact: boolean } | null> {
  return tryResolveSenderIdentity({
    senderHint: params.senderHint,
    senderFingerprint: params.senderFingerprint,
    embeddedIdentity: params.embeddedIdentity,
    loadContact: (hint) => loadContact(ctx, hint),
    fetchFromServer: ctx.server
      ? async (fingerprint) => {
        try {
          const res = await fetch(
            apiUrl(ctx.server!, `/api/v1/identity/${fingerprint}`),
          );
          if (!res.ok) return null;
          const data = await res.json();
          if (!data.signingKey || !data.encryptionKey) return null;
          return {
            fingerprint: data.fingerprint ?? fingerprint,
            signingKeyType: data.signingKeyType === "sphincs"
              ? "sphincs"
              : "dilithium",
            encryptionKeyType: "kyber",
            signingKey: data.signingKey,
            encryptionKey: data.encryptionKey,
            signingKeyDetails: (data.signingKeyDetails as ExternalIdentity[
              "signingKeyDetails"
            ]) ?? { variant: "ml_dsa87" },
            encryptionKeyDetails: (data.encryptionKeyDetails as ExternalIdentity[
              "encryptionKeyDetails"
            ]) ?? { variant: "ml_kem1024" },
            details: data.details ?? {},
            detailsMeta: data.detailsMeta ?? {},
          };
        } catch {
          return null;
        }
      }
      : undefined,
  });
}
