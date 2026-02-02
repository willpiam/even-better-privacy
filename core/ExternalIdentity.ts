import { SigningKeyOptions, EncryptionKeyOptions } from "./Keys.ts";

export type ExternalIdentity = {
    fingerprint: string;
    signingKeyType: SigningKeyOptions;
    encryptionKeyType: EncryptionKeyOptions;
    details: {[key: string]: [string, string]}; // object with string keys and string values
    signingKey: string;
    encryptionKey: string;
    signingKeyDetails: any;
    encryptionKeyDetails: any;
}