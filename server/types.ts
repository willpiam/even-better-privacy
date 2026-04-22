import type { IdentityState as CoreIdentityState } from "../core/StateHash.ts";

export type IdentityRow = {
  fingerprint: string;
  signing_key_type: "dilithium" | "sphincs";
  encryption_key_type: "kyber";
  signing_key: string;
  encryption_key: string;
  signing_key_details: Record<string, unknown> | null;
  encryption_key_details: Record<string, unknown> | null;
  created_at: number;
  revoked_at?: number | null;
  revocation_certificate?: string | null;
};

export type DetailPayload = {
  fingerprint: string;
  path: string;
  detail: string;
  proof: string;
};

export type RevocationPayload = {
  fingerprint: string;
  type: "detail" | "identity";
  target?: string;  // For detail revocations, the path being revoked
  certificate: string;  // Hex-encoded signed revocation certificate
};

export type RevocationRow = {
  id: number;
  identity_fingerprint: string;
  type: "detail" | "identity";
  target: string | null;
  nonce: number;
  certificate: string;
  created_at: number;
};

export type HierarchyCertificatePayload = {
  certificate: string;
};

export type HierarchyProposalPayload = {
  proposerFingerprint: string;
  certificate: string;
};

export type HierarchyAcceptPayload = {
  proposalId: number;
  certificate: string;
};

export type HierarchyRejectPayload = {
  proposalId: number;
  fingerprint: string;
  // F-SERVER-02: reject-action must be authenticated. `signature` is the
  // bech32 signer's signature over the canonical JSON of
  // {action:"reject", fingerprint, proposalId, timestamp}. `timestamp` is a
  // unix-ms integer that the server rejects if more than 5 minutes off.
  timestamp: number;
  signature: string;
};

export type HierarchyCertificateRow = {
  id: number;
  master_fingerprint: string;
  child_fingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
  certificate: string;
  created_at: number;
};

export type PendingHierarchyProposalRow = {
  id: number;
  master_fingerprint: string;
  child_fingerprint: string;
  proposer_fingerprint: string;
  certificate: string;
  context: string;
  expiry: number;
  created_at: number;
};

export type IdentityState = CoreIdentityState & {
  revoked?: boolean;
  revokedDetails?: string[];
};

export type DetailsMap = Record<string, [string, string]>;
export type AllDetailsMap = Record<string, DetailsMap>;

export type DetailsMetaMap = Record<string, { verified: boolean; verifiedAt: number | null }>;