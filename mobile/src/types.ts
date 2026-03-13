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
