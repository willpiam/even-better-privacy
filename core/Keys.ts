
export abstract class Key {
    abstract toFingerprint(): string;
    abstract toRawFingerprint(): Uint8Array;
    abstract toJSON(): string;
}

export abstract class AsymmetricKey extends Key {
    abstract get publicKey(): string;
}

export abstract class SigningKey extends AsymmetricKey {
    abstract verify(message: string, signature: string): boolean;
    abstract sign(message: string): string;
}

export abstract class AsymmetricEncryptionKey extends AsymmetricKey {
    abstract encrypt(message: string): string;
    abstract decrypt(ciphertext: string): string;
}


export type SigningKeyOptions = 'dilithium' | 'sphincs';
export type EncryptionKeyOptions = 'kyber';

