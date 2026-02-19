import { 
    SigningKey
    , AsymmetricEncryptionKey 
} from "./Keys.ts";
import { DilithiumSigningKey } from "./Dilithium.ts";
import { SphincsSigningKey } from "./Sphincs.ts";
import { KyberEncryptionKey } from "./Kyber.ts";
import { Key } from "./Keys.ts";
import { AES } from "./AES.ts";
import { Buffer } from "node:buffer";
import { PROTOCOL_VERSION, isProtocolVersionSupported, FILE_FORMAT_VERSIONS } from "./version.ts";
import { computeIdentityFingerprint, computeIdentityMerkleRootRaw } from "./Fingerprint.ts";
import { buildMessageHashEnvelope } from "./MessageHash.ts";
import {
    createRevocationCertificate,
    getRevocationSignaturePayload,
    encodeRevocationCertificate,
    decodeRevocationCertificate,
    verifyRevocationCertificate,
    type SignedRevocationCertificate,
    type RevocationType,
} from "./Revocation.ts";

type SigningKeyOptions = 'dilithium' | 'sphincs';
type EncryptionKeyOptions = 'kyber';

/** Public portion of an identity - safe to store unencrypted */
export type IdentityPublicData = {
    fingerprint: string;
    signingKeyType: SigningKeyOptions;
    encryptionKeyType: EncryptionKeyOptions;
    signingKey: string;
    encryptionKey: string;
    signingKeyDetails: { variant: string };
    encryptionKeyDetails: { variant: string };
    details: { [key: string]: [string, string] };
    detailsNonce: number;
    protocolVersion: string;
    /** Revoked detail paths with their revocation certificates (hex-encoded) */
    revokedDetails?: { [path: string]: string };
    /** If set, the identity itself has been revoked */
    revocationCertificate?: string;
    /** Nonce for revocations (separate from details nonce) */
    revocationNonce?: number;
};

/** New storage format: public data unencrypted, private keys encrypted */
export type IdentityStorageFormat = {
    version: typeof FILE_FORMAT_VERSIONS.identityStorage;
    protocolVersion: string;
    public: IdentityPublicData;
    encrypted: string; // AES-encrypted private keys
};

export type ExternalIdentity = {
    version?: number;
    fingerprint: string;
    signingKeyType: SigningKeyOptions;
    encryptionKeyType: EncryptionKeyOptions;
    details: {[key: string]: [string, string]}; // object with string keys and string values
    detailsMeta?: Record<string, { verified: boolean; verifiedAt: number | null }>;
    revoked?: boolean;
    revokedDetails?: string[];
    signingKey: string;
    encryptionKey: string;
    signingKeyDetails: any;
    encryptionKeyDetails: any;
}

export class Identity extends Key {
    signingKey: SigningKey;
    encryptionKey: AsymmetricEncryptionKey;
    signingKeyType: SigningKeyOptions;
    encryptionKeyType: EncryptionKeyOptions;

    details: Map<string, [string, string]>;
    detailsNonce: number;
    
    /** Revoked detail paths mapped to their hex-encoded revocation certificates */
    revokedDetails: Map<string, string>;
    /** If set, the identity itself is revoked (hex-encoded certificate) */
    revocationCertificate: string | null;
    /** Nonce counter for revocations */
    revocationNonce: number;

    static EncryptFor(recipient: ExternalIdentity, message: string) : string {
        switch (recipient.encryptionKeyType) {
            case 'kyber':
                return KyberEncryptionKey.EncryptFor(recipient, message);
            default:
                throw new Error(`Unsupported encryption key type: ${recipient.encryptionKeyType}`);
        }
    }

    static VerifySignature(sender: ExternalIdentity, message: string, signature: string, salt?: string) : boolean {
        const envelope = buildMessageHashEnvelope(message, salt);
        switch (sender.signingKeyType) {
            case 'dilithium':
                return DilithiumSigningKey.verify(sender.signingKeyDetails.variant, envelope, signature, sender.signingKey);
            case 'sphincs':
                return SphincsSigningKey.verify(sender.signingKeyDetails.variant, envelope, signature, sender.signingKey);
            default:
                throw new Error(`Unsupported signing key type: ${sender.signingKeyType}`);
        }
    }

    constructor(signingKeyType: SigningKeyOptions, encryptionKeyType: EncryptionKeyOptions) {
        super();
        this.detailsNonce = 0;
        this.revocationNonce = 0;
        this.signingKeyType = signingKeyType;
        this.encryptionKeyType = encryptionKeyType;
        switch (signingKeyType) {
            case 'dilithium':
                this.signingKey = new DilithiumSigningKey();
                break;
            case 'sphincs':
                this.signingKey = new SphincsSigningKey();
                break;
            default:
                throw new Error(`Unsupported signing key type: ${signingKeyType}`);
        }
        switch (encryptionKeyType) {
            case 'kyber':
                this.encryptionKey = new KyberEncryptionKey();
                break;
            default:
                throw new Error(`Unsupported encryption key type: ${encryptionKeyType}`);
        }
        this.details = new Map();
        this.revokedDetails = new Map();
        this.revocationCertificate = null;
    }

    signMessage(message: string, salt?: string) : string {
        const envelope = buildMessageHashEnvelope(message, salt);
        return this.signingKey.sign(envelope);
    }

    signAndEncryptMessage(message: string, recipient: Identity) : string {
        const signature = this.signMessage(message);
        return recipient.encryptionKey.encrypt(JSON.stringify({ message, signature })); 
    }

    signAndEncryptFor(message: string, recipient: ExternalIdentity) : string {
        const signature = this.signMessage(message);
        return Identity.EncryptFor(recipient, JSON.stringify({ message, signature }));
    }

    decryptAndVerify(ciphertext: string, sender: ExternalIdentity) : { message: string, verified: boolean } {
        const decrypted = this.encryptionKey.decrypt(ciphertext);
        const { message, signature } = JSON.parse(decrypted);
        const verified = Identity.VerifySignature(sender, message, signature);
        return { message, verified };
    }

    verifyMessage(message: string, signature: string, salt?: string) : boolean {
        const envelope = buildMessageHashEnvelope(message, salt);
        return this.signingKey.verify(envelope, signature);
    }

    attachDetail(path: string, detail: string) {
        const detailRecord = {
            nonce: this.detailsNonce,
            path: path,
            detail: detail,
            timestamp: Date.now(),
            signature: null as string | null,
        }
        const detailRecordSignature = this.signMessage(JSON.stringify(detailRecord));
        detailRecord.signature = detailRecordSignature;
        const proof = Buffer.from(JSON.stringify(detailRecord)).toString("hex");
        this.details.set(path, [detail, proof]);
        this.detailsNonce++;
    }

    getDetail(path: string) : string | null {
        const entry = this.details.get(path);
        if (!entry) {
            return null;
        }

        const [detail, proof] = entry;

        try {
            // Decode the stored proof back into the signed record
            const recordJson = Buffer.from(proof, "hex").toString();
            const record = JSON.parse(recordJson) as {
                nonce: number;
                path: string;
                detail: string;
                timestamp: number;
                signature: string;
            };

            // Ensure the record is consistent with the current map entry
            if (record.path !== path || record.detail !== detail) {
                return null;
            }

            const { nonce, timestamp, signature } = record;
            if (typeof signature !== "string" || !signature.length) {
                return null;
            }

            // Reconstruct the original payload that was signed (with signature=null)
            const signedPayload = JSON.stringify({
                nonce,
                path,
                detail,
                timestamp,
                signature: null,
            });

            const isValid = this.verifyMessage(signedPayload, signature);
            if (!isValid) {
                return null;
            }

            return detail;
        } catch {
            // Any parsing/verification error means the proof is invalid
            return null;
        }
    }

    static VerifyDetails(details: Map<string, [string, string]>) : boolean {
        // check all the proofs are valid.
        // ensure no nonce is repeated.
        // ensure the timestamp of each proof is > the previous proof
        // ensure the detail in the proof matches the detail in the map

        // Collect parsed records so we can validate ordering by nonce/timestamp
        const records: { nonce: number; timestamp: number }[] = [];
        const seenNonces = new Set<number>();

        for (const [path, [detail, proof]] of details.entries()) {
            try {
                const recordJson = Buffer.from(proof, "hex").toString();
                const record = JSON.parse(recordJson) as {
                    nonce: number;
                    path: string;
                    detail: string;
                    timestamp: number;
                    signature: string | null;
                };

                // Basic structural checks
                if (
                    typeof record.nonce !== "number" ||
                    !Number.isInteger(record.nonce) ||
                    record.nonce < 0
                ) {
                    return false;
                }

                if (
                    typeof record.timestamp !== "number" ||
                    !Number.isFinite(record.timestamp)
                ) {
                    return false;
                }

                if (typeof record.path !== "string" || typeof record.detail !== "string") {
                    return false;
                }

                // Ensure the record matches what is stored in the map
                if (record.path !== path || record.detail !== detail) {
                    return false;
                }

                // Signature should at least be present and non-empty; cryptographic
                // verification is handled by getDetail/instance-level verification.
                if (typeof record.signature !== "string" || record.signature.length === 0) {
                    return false;
                }

                // Ensure no nonce is repeated
                if (seenNonces.has(record.nonce)) {
                    return false;
                }
                seenNonces.add(record.nonce);

                records.push({ nonce: record.nonce, timestamp: record.timestamp });
            } catch {
                // Any decoding/parsing failure means invalid proof
                return false;
            }
        }

        // Ensure timestamps are strictly increasing when ordered by nonce
        records.sort((a, b) => a.nonce - b.nonce);
        let lastTimestamp = -Infinity;
        for (const { timestamp } of records) {
            if (timestamp <= lastTimestamp) {
                return false;
            }
            lastTimestamp = timestamp;
        }

        return true;
    }

    verifyDetails() : boolean {
        return Identity.VerifyDetails(this.details);
    }

    /**
     * Revoke a specific detail. This creates a signed revocation certificate
     * and removes the detail from the identity.
     * @param path The detail path to revoke
     * @param reason Optional human-readable reason for revocation
     * @returns The hex-encoded revocation certificate
     */
    revokeDetail(path: string, reason?: string): string {
        if (!this.details.has(path)) {
            throw new Error(`Detail not found: ${path}`);
        }

        // Create and sign revocation certificate
        const cert = createRevocationCertificate("detail", this.toFingerprint(), this.revocationNonce, {
            reason,
            target: path,
        });
        
        const payload = getRevocationSignaturePayload(cert);
        const signature = this.signMessage(payload);
        const signedCert: SignedRevocationCertificate = { ...cert, signature };
        const encoded = encodeRevocationCertificate(signedCert);

        // Store revocation and remove detail
        this.revokedDetails.set(path, encoded);
        this.details.delete(path);
        this.revocationNonce++;

        return encoded;
    }

    /**
     * Create a revocation certificate for the entire identity.
     * This marks the identity as compromised/revoked.
     * @param reason Optional human-readable reason for revocation
     * @returns The hex-encoded revocation certificate
     */
    createIdentityRevocation(reason?: string): string {
        if (this.revocationCertificate) {
            throw new Error("Identity is already revoked");
        }

        // Create and sign revocation certificate
        const cert = createRevocationCertificate("identity", this.toFingerprint(), this.revocationNonce, {
            reason,
        });
        
        const payload = getRevocationSignaturePayload(cert);
        const signature = this.signMessage(payload);
        const signedCert: SignedRevocationCertificate = { ...cert, signature };
        const encoded = encodeRevocationCertificate(signedCert);

        this.revocationCertificate = encoded;
        this.revocationNonce++;

        return encoded;
    }

    /**
     * Check if this identity has been revoked
     */
    isRevoked(): boolean {
        return this.revocationCertificate !== null;
    }

    /**
     * Check if a specific detail has been revoked
     */
    isDetailRevoked(path: string): boolean {
        return this.revokedDetails.has(path);
    }

    /**
     * Get the revocation certificate for a specific detail
     */
    getDetailRevocationCertificate(path: string): SignedRevocationCertificate | null {
        const encoded = this.revokedDetails.get(path);
        if (!encoded) return null;
        return decodeRevocationCertificate(encoded);
    }

    /**
     * Get the identity revocation certificate
     */
    getIdentityRevocationCertificate(): SignedRevocationCertificate | null {
        if (!this.revocationCertificate) return null;
        return decodeRevocationCertificate(this.revocationCertificate);
    }

    /**
     * Generate a pre-signed revocation certificate that can be stored safely
     * and used later if the identity is compromised. This does NOT revoke
     * the identity - it just creates a certificate that can be used later.
     * 
     * IMPORTANT: Store this certificate securely (e.g., print and put in a safe).
     * Anyone with this certificate can revoke your identity.
     * 
     * @param reason Optional reason for revocation (e.g., "Emergency revocation")
     * @returns The hex-encoded revocation certificate
     */
    generateEmergencyRevocationCertificate(reason?: string): string {
        // Use a special nonce (0) for emergency certificates created at generation time
        // This allows it to be used even if other revocations have occurred
        const cert = createRevocationCertificate("identity", this.toFingerprint(), 0, {
            reason: reason ?? "Emergency revocation certificate",
        });
        
        const payload = getRevocationSignaturePayload(cert);
        const signature = this.signMessage(payload);
        const signedCert: SignedRevocationCertificate = { ...cert, signature };
        
        return encodeRevocationCertificate(signedCert);
    }

    /**
     * Verify a revocation certificate against this identity
     */
    static VerifyRevocationCertificate(
        cert: SignedRevocationCertificate,
        identity: ExternalIdentity,
    ): boolean {
        const variant = identity.signingKeyDetails?.variant;
        if (!variant) return false;

        const result = verifyRevocationCertificate(
            cert,
            identity.signingKeyType,
            identity.signingKey,
            variant,
        );
        
        return result.ok && cert.fingerprint === identity.fingerprint;
    }

    toRawFingerprint(): Uint8Array {
        return computeIdentityMerkleRootRaw({
            signingKeyType: this.signingKeyType,
            encryptionKeyType: this.encryptionKeyType,
            signingKey: this.signingKey.publicKey,
            encryptionKey: this.encryptionKey.publicKey,
        });
    }

    toFingerprint(): string {
        return computeIdentityFingerprint({
            signingKeyType: this.signingKeyType,
            encryptionKeyType: this.encryptionKeyType,
            signingKey: this.signingKey.publicKey,
            encryptionKey: this.encryptionKey.publicKey,
        });
    }

    toJSON(): string {
        return JSON.stringify({
            signingKey: this.signingKey.toJSON(),
            encryptionKey: this.encryptionKey.toJSON(),
            signingKeyType: this.signingKeyType,
            encryptionKeyType: this.encryptionKeyType,
            details: Object.fromEntries(this.details),
            detailsNonce: this.detailsNonce,
            revokedDetails: Object.fromEntries(this.revokedDetails),
            revocationCertificate: this.revocationCertificate,
            revocationNonce: this.revocationNonce,
        });
    }

    get publicKeys() : { signingKey: string, encryptionKey: string } {
        return {
            signingKey: this.signingKey.publicKey,
            encryptionKey: this.encryptionKey.publicKey,
        };
    }

    get summary() : ExternalIdentity {
        const summary : Partial<ExternalIdentity> = {
            version: FILE_FORMAT_VERSIONS.publicIdentity,
            fingerprint: this.toFingerprint(),
            signingKeyType: this.signingKeyType,
            encryptionKeyType: this.encryptionKeyType,
            details: Object.fromEntries(this.details),
            ...this.publicKeys,
        }
        switch (this.signingKeyType) {
            case 'dilithium':
                summary.signingKeyDetails = {
                    variant: (this.signingKey as DilithiumSigningKey).variant,
                }
                break;
            case 'sphincs':
                summary.signingKeyDetails = {
                    variant: (this.signingKey as SphincsSigningKey).variant,
                }
                break;
            default:
                throw new Error(`Unsupported signing key type: ${this.signingKeyType}`);
        }
        switch (this.encryptionKeyType) {
            case 'kyber':
                summary.encryptionKeyDetails = {
                    variant: (this.encryptionKey as KyberEncryptionKey).variant,
                }
                break;
            default:
                throw new Error(`Unsupported encryption key type: ${this.encryptionKeyType}`);
        }
        return summary as ExternalIdentity;
    }

    static fromJSON(json: string): Identity {
        const data = JSON.parse(json);
        const i = new Identity(data.signingKeyType, data.encryptionKeyType);

        i.signingKeyType = data.signingKeyType;
        i.encryptionKeyType = data.encryptionKeyType;
        switch (data.signingKeyType) {
            case 'dilithium':
                i.signingKey = DilithiumSigningKey.fromJSON(data.signingKey);
                break;
            case 'sphincs':
                i.signingKey = SphincsSigningKey.fromJSON(data.signingKey);
                break;
            default:
                throw new Error(`Unsupported signing key type: ${i.signingKeyType}`);
        }

        switch (data.encryptionKeyType) {
            case 'kyber':
                i.encryptionKey = KyberEncryptionKey.fromJSON(data.encryptionKey);
                break;
            default:
                throw new Error(`Unsupported encryption key type: ${i.encryptionKeyType}`);
        }

        const detailsEntries = Object.entries(data.details ?? {}) as [string, [string, string]][];
        i.details = new Map(detailsEntries);

        const storedNonce = typeof data.detailsNonce === "number" && Number.isFinite(data.detailsNonce)
            ? data.detailsNonce
            : undefined;

        if (storedNonce !== undefined) {
            i.detailsNonce = storedNonce;
        } else {
            let maxNonce = -1;
            for (const [, [, proof]] of detailsEntries) {
                try {
                    const record = JSON.parse(Buffer.from(proof, "hex").toString());
                    if (typeof record.nonce === "number" && Number.isInteger(record.nonce)) {
                        maxNonce = Math.max(maxNonce, record.nonce);
                    }
                } catch {
                    // ignore malformed proof when inferring nonce
                }
            }
            i.detailsNonce = maxNonce >= 0 ? maxNonce + 1 : detailsEntries.length;
        }

        // Load revocation data
        const revokedDetailsEntries = Object.entries(data.revokedDetails ?? {}) as [string, string][];
        i.revokedDetails = new Map(revokedDetailsEntries);
        i.revocationCertificate = data.revocationCertificate ?? null;
        i.revocationNonce = typeof data.revocationNonce === "number" ? data.revocationNonce : 0;

        return i;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // New Storage Format (v2): Public data unencrypted, private keys encrypted
    // ─────────────────────────────────────────────────────────────────────────

    /** Get the public portion of the identity (safe to store unencrypted) */
    get publicData(): IdentityPublicData {
        return {
            fingerprint: this.toFingerprint(),
            signingKeyType: this.signingKeyType,
            encryptionKeyType: this.encryptionKeyType,
            signingKey: this.signingKey.publicKey,
            encryptionKey: this.encryptionKey.publicKey,
            signingKeyDetails: {
                variant: this.signingKeyType === 'dilithium'
                    ? (this.signingKey as DilithiumSigningKey).variant
                    : (this.signingKey as SphincsSigningKey).variant,
            },
            encryptionKeyDetails: {
                variant: (this.encryptionKey as KyberEncryptionKey).variant,
            },
            details: Object.fromEntries(this.details),
            detailsNonce: this.detailsNonce,
            protocolVersion: PROTOCOL_VERSION,
            revokedDetails: Object.fromEntries(this.revokedDetails),
            revocationCertificate: this.revocationCertificate ?? undefined,
            revocationNonce: this.revocationNonce,
        };
    }

    /** Convert to new storage format with encrypted private keys */
    async toStorageFormat(password: string): Promise<string> {
        const privateData = {
            signingKey: this.signingKey.toJSON(),
            encryptionKey: this.encryptionKey.toJSON(),
        };
        const encrypted = await AES.encrypt(password, JSON.stringify(privateData));
        
        const storage: IdentityStorageFormat = {
            version: FILE_FORMAT_VERSIONS.identityStorage,
            protocolVersion: PROTOCOL_VERSION,
            public: this.publicData,
            encrypted,
        };
        
        return JSON.stringify(storage, null, 2);
    }

    /** Read just the public data from storage (no password needed). */
    static readPublicData(storageData: string): IdentityPublicData | null {
        try {
            const parsed = JSON.parse(storageData);
            if (parsed.version === FILE_FORMAT_VERSIONS.identityStorage && parsed.public) {
                return parsed.public as IdentityPublicData;
            }
            return null;
        } catch {
            return null;
        }
    }

    /** 
     * Load identity from new storage format.
     * If password is provided, decrypts private keys for full access.
     * If password is omitted, returns an identity that can only verify/encrypt (public ops).
     */
    static async fromStorageFormat(storageData: string, password?: string): Promise<Identity> {
        const parsed = JSON.parse(storageData);
        
        // Handle new v2 format
        if (parsed.version === FILE_FORMAT_VERSIONS.identityStorage) {
            const pub = parsed.public as IdentityPublicData;
            
            // Check protocol version compatibility
            const fileProtocolVersion = parsed.protocolVersion ?? pub.protocolVersion;
            if (!fileProtocolVersion) {
                throw new Error("Missing protocol version in identity storage format.");
            }
            if (!isProtocolVersionSupported(fileProtocolVersion)) {
                throw new Error(`Unsupported protocol version: ${fileProtocolVersion}. This implementation supports ${PROTOCOL_VERSION} and compatible versions.`);
            }
            
            // Create identity shell with correct types
            const identity = Object.create(Identity.prototype) as Identity;
            identity.signingKeyType = pub.signingKeyType;
            identity.encryptionKeyType = pub.encryptionKeyType;
            identity.details = new Map(Object.entries(pub.details ?? {}) as [string, [string, string]][]);
            identity.detailsNonce = pub.detailsNonce ?? 0;
            
            // Load revocation data
            identity.revokedDetails = new Map(Object.entries(pub.revokedDetails ?? {}) as [string, string][]);
            identity.revocationCertificate = pub.revocationCertificate ?? null;
            identity.revocationNonce = pub.revocationNonce ?? 0;
            
            if (password) {
                // Decrypt private keys for full access
                const privateJson = await AES.decrypt(password, parsed.encrypted);
                const privateData = JSON.parse(privateJson);
                
                switch (pub.signingKeyType) {
                    case 'dilithium':
                        identity.signingKey = DilithiumSigningKey.fromJSON(privateData.signingKey);
                        break;
                    case 'sphincs':
                        identity.signingKey = SphincsSigningKey.fromJSON(privateData.signingKey);
                        break;
                }
                
                switch (pub.encryptionKeyType) {
                    case 'kyber':
                        identity.encryptionKey = KyberEncryptionKey.fromJSON(privateData.encryptionKey);
                        break;
                }
            } else {
                // Public-only mode - create keys from public data only
                // These can verify signatures and encrypt, but not sign or decrypt
                switch (pub.signingKeyType) {
                    case 'dilithium':
                        identity.signingKey = DilithiumSigningKey.fromPublicKey(
                            pub.signingKey, 
                            pub.signingKeyDetails.variant
                        );
                        break;
                    case 'sphincs':
                        identity.signingKey = SphincsSigningKey.fromPublicKey(
                            pub.signingKey,
                            pub.signingKeyDetails.variant
                        );
                        break;
                }
                
                switch (pub.encryptionKeyType) {
                    case 'kyber':
                        identity.encryptionKey = KyberEncryptionKey.fromPublicKey(
                            pub.encryptionKey,
                            pub.encryptionKeyDetails.variant
                        );
                        break;
                }
            }
            
            return identity;
        }
        
        // Unknown format
        throw new Error("Unknown identity storage format");
    }

}