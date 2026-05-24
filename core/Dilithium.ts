import { sha256 } from "@noble/hashes/sha2";
import { base64ToBytes, bytesToBase64 } from "./Base64.ts";
import { SigningKey } from "./Keys.ts";
import * as dilithium from "@noble/post-quantum/ml-dsa";
import { toHex } from "./Hex.ts";

type DilithiumVariant = {
    keygen: (seed?: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array };
    sign: (message: Uint8Array, secretKey: Uint8Array) => Uint8Array;
    verify: (signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array) => boolean;
};

export class DilithiumSigningKey  extends SigningKey {
    static listVariants(): string[] {
        return Object.keys(dilithium).filter(el => el.startsWith("ml_dsa"));
    }

    public variant: string;
    private key: { publicKey: Uint8Array; secretKey: Uint8Array };
    get publicKey(): string {
        return bytesToBase64(this.key.publicKey);
    }

    constructor(variant: string = "ml_dsa87", options?: { seed?: Uint8Array }) {
        super();
        if (!DilithiumSigningKey.listVariants().includes(variant)) {
            throw new Error(`Invalid Dilithium variant: ${variant}`);
        }
        this.variant = variant;
        const keygen = ((dilithium as unknown) as Record<string, DilithiumVariant>)[this.variant]?.keygen;
        if (typeof keygen !== 'function') {
            throw new Error(`Unsupported or invalid Dilithium variant: ${this.variant}`);
        }
        this.key = (keygen as (seed?: Uint8Array) => { publicKey: Uint8Array; secretKey: Uint8Array })(options?.seed);
    }

    toRawFingerprint(): Uint8Array {
        return sha256(this.key.publicKey);
    }

    toFingerprint(): string {
        return toHex(this.toRawFingerprint());
    }

    toJSON(): string {
        return JSON.stringify({
            variant: this.variant,
            fingerprint: this.toFingerprint(),
            publicKey: bytesToBase64(this.key.publicKey),
            secretKey: bytesToBase64(this.key.secretKey),
        }, null, 2);
    }

    static fromJSON(json: string): DilithiumSigningKey {
        const data = JSON.parse(json);
        const instance = new DilithiumSigningKey(data.variant);
        instance.key = {
            publicKey: base64ToBytes(data.publicKey),
            secretKey: base64ToBytes(data.secretKey),
        };
        return instance;
    }

    /** Create a public-key-only instance (can verify but not sign) */
    static fromPublicKey(publicKey: string, variant: string = "ml_dsa87"): DilithiumSigningKey {
        const instance = Object.create(DilithiumSigningKey.prototype) as DilithiumSigningKey;
        instance.variant = variant;
        instance.key = {
            publicKey: base64ToBytes(publicKey),
            secretKey: new Uint8Array(0), // Empty - signing will fail
        };
        return instance;
    }

    static verify(variant: string, message: string, signature: string, publicKey: string): boolean {
        const encodedSignature = base64ToBytes(signature);
        const encodedMessage = new TextEncoder().encode(message);
        const encodedPublicKey = base64ToBytes(publicKey);
        const variantImpl = ((dilithium as unknown) as Record<string, DilithiumVariant>)[variant];
        if (!variantImpl || typeof variantImpl.verify !== "function") {
            throw new Error(`Unsupported or invalid Dilithium variant: ${variant}`);
        }
        return variantImpl.verify(encodedSignature, encodedMessage, encodedPublicKey);
    }

    verify(message: string, signature: string): boolean {
        return DilithiumSigningKey.verify(this.variant, message, signature, bytesToBase64(this.key.publicKey));
    }

    sign(message: string): string {
        const encodedMessage = new TextEncoder().encode(message);
        const variantImpl = ((dilithium as unknown) as Record<string, DilithiumVariant>)[this.variant];
        if (!variantImpl || typeof variantImpl.sign !== "function") {
            throw new Error(`Unsupported or invalid Dilithium variant: ${this.variant}`);
        }
        const signature = variantImpl.sign(encodedMessage, this.key.secretKey);
        return bytesToBase64(signature);
    }

}