export type SigningType = 'dilithium' | 'sphincs';

export type StoredIdentityMeta = {
  name: string;
  fingerprint: string;
  signingKeyType: SigningType;
  encryptionKeyType: 'kyber';
};

export type AppState = {
  currentIdentity: string | null;
};

export type ContactMeta = {
  name: string;
  fingerprint: string;
  signingKeyType: SigningType;
  encryptionKeyType: 'kyber';
  details: Record<string, [string, string]>;
  detailsMeta?: Record<string, {verified: boolean; verifiedAt: number | null}>;
  revoked?: boolean;
  revokedDetails?: string[];
};

export type HierarchyCertificateMeta = {
  certificate: string;
  masterFingerprint: string;
  childFingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
};

export type PendingHierarchyMeta = {
  id: number;
  masterFingerprint: string;
  childFingerprint: string;
  proposerFingerprint: string;
  certificate: string;
  context: string;
  expiry: number;
  createdAt: number;
};
