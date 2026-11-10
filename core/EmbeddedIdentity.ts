import type { ExternalIdentity } from "./ExternalIdentity.ts";
import { computeExternalFingerprint } from "./Fingerprint.ts";
import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { hexToBytes } from "./Hex.ts";

export function externalIdentityFromEmbeddedRecord(
  record: Record<string, unknown>,
  expectedSenderFingerprint?: string,
): ExternalIdentity | null {
  if ((record.signingKeyType !== undefined && record.signingKeyType !== "dilithium" && record.signingKeyType !== "sphincs") ||
      (record.encryptionKeyType !== undefined && record.encryptionKeyType !== "kyber") ||
      (record.fingerprint !== undefined && typeof record.fingerprint !== "string")) return null;
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

  const signSizes: Record<string, number> = {ml_dsa44: 1312, ml_dsa65: 1952, ml_dsa87: 2592};
  for (const hash of ["sha2", "shake"]) for (const size of [128, 192, 256]) for (const mode of ["f", "s"]) {
    signSizes[`slh_dsa_${hash}_${size}${mode}`] = size / 4;
  }
  const kemSizes: Record<string, number> = {ml_kem512: 800, ml_kem768: 1184, ml_kem1024: 1568};
  try {
    const signVariant = ext.signingKeyDetails?.variant ?? "";
    const kemVariant = ext.encryptionKeyDetails?.variant ?? "";
    const signingBytes = base64ToBytes(signingKey);
    if (!signVariant.startsWith(signingKeyType === "sphincs" ? "slh_dsa_" : "ml_dsa") ||
      signingBytes.length !== signSizes[signVariant] || bytesToBase64(signingBytes) !== signingKey ||
      hexToBytes(encryptionKey).length !== kemSizes[kemVariant]) return null;
  } catch {
    return null;
  }

  const computed = computeExternalFingerprint(ext);
  if (!computed) {
    return null;
  }
  if (ext.fingerprint && ext.fingerprint !== computed) return null;
  if (expectedSenderFingerprint && computed !== expectedSenderFingerprint) {
    return null;
  }
  ext.fingerprint = computed;
  return ext;
}
