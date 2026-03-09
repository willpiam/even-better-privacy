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

export type IdentityState = CoreIdentityState & {
  revoked?: boolean;
  revokedDetails?: string[];
};

export type DetailsMap = Record<string, [string, string]>;
export type AllDetailsMap = Record<string, DetailsMap>;

export type DetailsMetaMap = Record<string, { verified: boolean; verifiedAt: number | null }>;