import { assert, assertEquals } from "jsr:@std/assert@^1.0.6";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";
import { gcm } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/hashes/utils";
import { AES } from "../AES.ts";
import { Identity } from "../Identity.ts";
import { bytesToBase64, base64ToBytes } from "../Base64.ts";
import { FILE_FORMAT_VERSIONS } from "../version.ts";

// F-STORAGE-02 regression tests.

Deno.test("F-STORAGE-02: AES.encrypt emits the current ciphertext version", () => {
	const ct = AES.encrypt("password12345", "hello");
	assertEquals(AES.getCiphertextVersion(ct), FILE_FORMAT_VERSIONS.aesCiphertext);
	assertEquals(FILE_FORMAT_VERSIONS.aesCiphertext, 4);
});

Deno.test("F-STORAGE-02: AES.decrypt remains backward-compatible with v1 ciphertexts", () => {
	// Synthesize a v1 blob by producing a v2 blob and mutating the version byte
	// would break the KDF. Instead we rebuild a v1 blob end-to-end by calling
	// the pbkdf2 primitives the same way the old code did.
	//
	// Easier: encrypt at v2, then decrypt, then manually re-derive using the
	// old 310_000 iteration count and reassemble. For robustness we use the
	// noble primitives directly.

	const password = "legacy-pw";
	const plaintext = "legacy plaintext payload";
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = pbkdf2(sha256, new TextEncoder().encode(password), salt, {
		c: 310_000,
		dkLen: 32,
	});
	const ciphertext = gcm(key, iv).encrypt(new TextEncoder().encode(plaintext));
	const result = new Uint8Array(1 + salt.length + iv.length + ciphertext.length);
	result[0] = 1; // v1
	result.set(salt, 1);
	result.set(iv, 1 + salt.length);
	result.set(ciphertext, 1 + salt.length + iv.length);
	const v1Blob = bytesToBase64(result);

	assertEquals(AES.getCiphertextVersion(v1Blob), 1);
	assert(AES.isLegacyCiphertext(v1Blob));
	assertEquals(AES.decrypt(password, v1Blob), plaintext);
});

Deno.test("F-STORAGE-02: Identity.isStorageEncryptedWithLegacyKDF detects v1 blobs", () => {
	const identity = new Identity("dilithium", "kyber");
	const storageV2 = identity.toStorageFormat("password12345");
	assert(!Identity.isStorageEncryptedWithLegacyKDF(storageV2));

	// Forge a legacy storage blob by re-wrapping the encrypted field.
	const parsed = JSON.parse(storageV2);
	const enc = base64ToBytes(parsed.encrypted);
	enc[0] = 1; // downgrade version byte to v1 on the wire
	parsed.encrypted = bytesToBase64(enc);
	const legacy = JSON.stringify(parsed);
	assert(Identity.isStorageEncryptedWithLegacyKDF(legacy));
});
