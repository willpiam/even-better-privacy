import * as slh_dsa from "jsr:@noble/post-quantum/slh-dsa.js";
import { sha256 } from "@noble/hashes/sha2";
import { SigningKey } from "./Keys.ts";
import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { Buffer } from "node:buffer";

type SphincsVariant = {
	keygen: () => { publicKey: Uint8Array; secretKey: Uint8Array };
	sign: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
	verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;
};

export class SphincsSigningKey extends SigningKey {
    private key: { publicKey: Uint8Array; secretKey: Uint8Array };
    public variant: string;

    get publicKey(): string {
        return bytesToBase64(this.key.publicKey);
    }

    constructor(variant: string = "slh_dsa_sha2_256s") {
        super();
        // assert that the variant is valid
        if (!SphincsSigningKey.listVariants().includes(variant)) {
            throw new Error(`Invalid Sphincs variant: ${variant}`);
        }
        this.variant = variant;
        const keygen = ((slh_dsa as unknown) as Record<string, SphincsVariant>)[this.variant]?.keygen;
        if (typeof keygen !== 'function') {
            throw new Error(`Unsupported or invalid SLH-DSA variant: ${this.variant}`);
        }
        this.key = (keygen as () => { publicKey: Uint8Array; secretKey: Uint8Array })();
    }

    static verify(variant: string, message: string, signature: string, publicKey: string): boolean {
        const encodedSignature = base64ToBytes(signature);
        const encodedMessage = new TextEncoder().encode(message);
        const encodedPublicKey = base64ToBytes(publicKey);
        const variantImpl = ((slh_dsa as unknown) as Record<string, SphincsVariant>)[variant];
        if (!variantImpl || typeof variantImpl.verify !== "function") {
            throw new Error(`Unsupported or invalid SLH-DSA variant: ${variant}`);
        }
        return variantImpl.verify(encodedSignature, encodedMessage, encodedPublicKey);
    }

    verify(message: string, signature: string): boolean {
        return SphincsSigningKey.verify(this.variant, message, signature, bytesToBase64(this.key.publicKey));
    }

    sign(message: string): string {
        const encodedMessage = new TextEncoder().encode(message);
        const variantImpl = ((slh_dsa as unknown) as Record<string, SphincsVariant>)[this.variant];
        if (!variantImpl || typeof variantImpl.sign !== "function") {
            throw new Error(`Unsupported or invalid SLH-DSA variant: ${this.variant}`);
        }
        const signature = variantImpl.sign(encodedMessage, this.key.secretKey);
		return bytesToBase64(signature);
    }

    toRawFingerprint(): Uint8Array {
        return sha256(this.key.publicKey);
    }

    toFingerprint(): string {
        return Buffer.from(this.toRawFingerprint()).toString("hex");
    }

    static listVariants(): string[] {
        return Object.keys(slh_dsa).filter(el => el.startsWith("slh_dsa_"));
    }

    toJSON(): string {
        return JSON.stringify({
            variant: this.variant,
            fingerprint: this.toFingerprint(),
            publicKey: bytesToBase64(this.key.publicKey),
            secretKey: bytesToBase64(this.key.secretKey),
        }, null, 2);
    }

    static fromJSON(json: string): SphincsSigningKey {
        const data = JSON.parse(json);
        const instance = new SphincsSigningKey(data.variant);
        instance.key = {
            publicKey: base64ToBytes(data.publicKey),
            secretKey: base64ToBytes(data.secretKey),
        };
        return instance;
    }

    /** Create a public-key-only instance (can verify but not sign) */
    static fromPublicKey(publicKey: string, variant: string = "slh_dsa_sha2_256s"): SphincsSigningKey {
        const instance = Object.create(SphincsSigningKey.prototype) as SphincsSigningKey;
        instance.variant = variant;
        instance.key = {
            publicKey: base64ToBytes(publicKey),
            secretKey: new Uint8Array(0), // Empty - signing will fail
        };
        return instance;
    }
}