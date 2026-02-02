import { 
     AsymmetricEncryptionKey
 } from "./Keys.ts";
import * as kyber from "jsr:@noble/post-quantum/ml-kem.js";
import { randomBytes } from "@noble/hashes/utils";
import { Buffer } from "node:buffer";
import { sha256 } from "@noble/hashes/sha2";
import { gcm } from "@noble/ciphers/aes";
import { ExternalIdentity } from "./ExternalIdentity.ts";

type KyberVariant = {
    keygen: (seed: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array };
    encapsulate: (publicKey: Uint8Array) => { cipherText: Uint8Array; sharedSecret: Uint8Array };
    decapsulate: (cipherText: Uint8Array, secretKey: Uint8Array) => Uint8Array;
};

// ML-KEM ciphertext sizes (encapsulated key sizes) per variant
const CIPHERTEXT_SIZES: Record<string, number> = {
    ml_kem512: 768,
    ml_kem768: 1088,
    ml_kem1024: 1568,
};

const AES_GCM_NONCE_SIZE = 12;

// for now we will use kyber as an asymmetric encryption scheme...later we will create a KyberEncapsulationKey class and use that class in this class

export class KyberEncryptionKey extends AsymmetricEncryptionKey {
    
    public variant: string;
    private seed: Uint8Array;
    private key: { publicKey: Uint8Array; secretKey: Uint8Array };

    get publicKey(): string {
        return Buffer.from(this.key.publicKey).toString("hex");
    }

    constructor(variant: string = "ml_kem1024") {
        super();
        // assert that the variant is valid
        if (!KyberEncryptionKey.listVariants().includes(variant)) {
            throw new Error(`Invalid Kyber KEM variant: ${variant}`);
        }
        this.variant = variant;
        this.seed = randomBytes(64);
        this.key = ((kyber as unknown) as Record<string, KyberVariant>)[this.variant]?.keygen(this.seed);
    }

    toRawFingerprint(): Uint8Array {
        return sha256(this.publicKey);
    }

    toFingerprint(): string {
        return Buffer.from(this.toRawFingerprint()).toString("hex");
    }

    static listVariants(): string[] {
        return Object.keys(kyber).filter(el => el.startsWith("ml_kem"));
    }


    static EncryptFor(recipient: ExternalIdentity, message: string) : string {
        const variantName = recipient.encryptionKeyDetails?.variant ?? "ml_kem1024";
        if (!KyberEncryptionKey.listVariants().includes(variantName)) {
            throw new Error(`Invalid Kyber KEM variant: ${variantName}`);
        }

        const variant = ((kyber as unknown) as Record<string, KyberVariant>)[variantName];
        const recipientPublicKey = Buffer.from(recipient.encryptionKey, "hex");

        // Encapsulate to derive shared secret with recipient's public key
        const { cipherText: encapsulatedKey, sharedSecret } = variant.encapsulate(recipientPublicKey);

        // Encrypt message using AES-256-GCM with derived shared secret
        const nonce = randomBytes(AES_GCM_NONCE_SIZE);
        const messageBytes = new TextEncoder().encode(message);
        const cipher = gcm(sharedSecret, nonce);
        const encryptedMessage = cipher.encrypt(messageBytes);

        // Return hex-encoded payload: encapsulated key || nonce || ciphertext
        const result = Buffer.concat([encapsulatedKey, nonce, encryptedMessage]);
        return Buffer.from(result).toString("hex");
    }

    // Encrypts a message using Kyber KEM + AES-256-GCM
    // Returns hex-encoded: <encapsulated key><nonce><encrypted message>
    encrypt(message: string): string {
        const variant = ((kyber as unknown) as Record<string, KyberVariant>)[this.variant];
        
        // Encapsulate to derive a shared secret (32 bytes for AES-256)
        const { cipherText: encapsulatedKey, sharedSecret } = variant.encapsulate(this.key.publicKey);
        
        // Generate a random 12-byte nonce for AES-256-GCM
        const nonce = randomBytes(AES_GCM_NONCE_SIZE);
        
        // Encrypt the message using AES-256-GCM (sharedSecret is 32 bytes = 256 bits)
        const messageBytes = new TextEncoder().encode(message);
        const cipher = gcm(sharedSecret, nonce);
        const encryptedMessage = cipher.encrypt(messageBytes);
        
        // Concatenate: encapsulatedKey || nonce || encryptedMessage
        const result = Buffer.concat([encapsulatedKey, nonce, encryptedMessage]);
        return Buffer.from(result).toString("hex");
    }

    // Decrypts the result of the encrypt function
    decrypt(ciphertext: string): string {
        const variant = ((kyber as unknown) as Record<string, KyberVariant>)[this.variant];
        const ciphertextSize = CIPHERTEXT_SIZES[this.variant]!;
        
        // Parse the hex-encoded ciphertext
        const data = Buffer.from(ciphertext, "hex");
        
        // Extract components: encapsulatedKey || nonce || encryptedMessage
        const encapsulatedKey = data.subarray(0, ciphertextSize);
        const nonce = data.subarray(ciphertextSize, ciphertextSize + AES_GCM_NONCE_SIZE);
        const encryptedMessage = data.subarray(ciphertextSize + AES_GCM_NONCE_SIZE);
        
        // Decapsulate to recover the shared secret
        const sharedSecret = variant.decapsulate(encapsulatedKey, this.key.secretKey);
        
        // Decrypt the message using AES-256-GCM
        const decipher = gcm(sharedSecret, nonce);
        const decryptedBytes = decipher.decrypt(encryptedMessage);
        
        return new TextDecoder().decode(decryptedBytes);
    }

    toJSON(): string {
        return JSON.stringify({
            variant: this.variant,
            fingerprint: this.toFingerprint(),
            publicKey: this.publicKey,
            secretKey: Buffer.from(this.key.secretKey).toString("hex"),
        }, null, 2);
    }
    
    static fromJSON(json: string): KyberEncryptionKey {
        const data = JSON.parse(json);
        const instance = new KyberEncryptionKey(data.variant);
        instance.key = {
            publicKey: Buffer.from(data.publicKey, "hex"),
            secretKey: Buffer.from(data.secretKey, "hex"),
        };
        return instance;
    }

    /** Create a public-key-only instance (can encrypt but not decrypt) */
    static fromPublicKey(publicKey: string, variant: string = "ml_kem1024"): KyberEncryptionKey {
        const instance = Object.create(KyberEncryptionKey.prototype) as KyberEncryptionKey;
        instance.variant = variant;
        instance.seed = new Uint8Array(0); // Empty
        instance.key = {
            publicKey: Buffer.from(publicKey, "hex"),
            secretKey: new Uint8Array(0), // Empty - decryption will fail
        };
        return instance;
    }
}
