import { SigningKeyOptions, EncryptionKeyOptions } from "./Keys.ts";

export type ExternalIdentity = {
    version?: number;
    fingerprint: string;
    signingKeyType: SigningKeyOptions;
    encryptionKeyType: EncryptionKeyOptions;
    details: {[key: string]: [string, string]}; // object with string keys and string values
    detailsMeta?: Record<string, { verified: boolean; verifiedAt: number | null }>;
    signingKey: string;
    encryptionKey: string;
    signingKeyDetails: any;
    encryptionKeyDetails: any;
}