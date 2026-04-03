import type { EncryptionKeyOptions, SigningKeyOptions } from "./Keys.ts";

export type ExternalIdentity = {
  version?: number;
  fingerprint: string;
  signingKeyType: SigningKeyOptions;
  encryptionKeyType: EncryptionKeyOptions;
  details: Record<string, [string, string]>;
  resolvedOpaqueDetails?: Record<string, string>;
  detailsMeta?: Record<string, { verified: boolean; verifiedAt: number | null }>;
  revoked?: boolean;
  revokedDetails?: string[];
  signingKey: string;
  encryptionKey: string;
  signingKeyDetails: { variant: string } & Record<string, unknown>;
  encryptionKeyDetails: { variant: string } & Record<string, unknown>;
};