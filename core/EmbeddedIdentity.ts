import type { ExternalIdentity } from "./ExternalIdentity.ts";
import { computeExternalFingerprint } from "./Fingerprint.ts";

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
