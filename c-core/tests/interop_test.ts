import { deepStrictEqual as assertEquals } from "node:assert/strict";
import * as dsaVariants from "@noble/post-quantum/ml-dsa";
import * as slhVariants from "@noble/post-quantum/slh-dsa";
import * as kemVariants from "@noble/post-quantum/ml-kem";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem";
import { slh_dsa_sha2_256s } from "@noble/post-quantum/slh-dsa";
import { deriveAccountNode, deriveIdentitySeeds } from "../../core/Hd.ts";
import { computeIdentityFingerprint } from "../../core/Fingerprint.ts";
import { bytesToBase64 } from "../../core/Base64.ts";
import { BIP39_ENGLISH_WORDLIST } from "../../core/bip39-english.ts";
import { entropyToMnemonic, mnemonicToSeed } from "../../core/Mnemonic.ts";
import { armorPayload, buildSignedMessagePayload, buildEncryptedSignedMessageMultiPayload } from "../../core/Payloads.ts";
import { parseEbpPayloadInput } from "../../core/PayloadInput.ts";
import { createFileCleartextEnvelope, parseFileCleartextEnvelope } from "../../core/FilePayload.ts";
import { AES } from "../../core/AES.ts";
import { MultiRecipientCipher } from "../../core/MultiRecipientCipher.ts";
import { KyberEncryptionKey } from "../../core/Kyber.ts";
import { verifyDetailProof } from "../../core/DetailProof.ts";
import { createRevocationCertificate, getRevocationSignaturePayload, encodeRevocationCertificate, decodeAndVerifyRevocationCertificate } from "../../core/Revocation.ts";
import { createHierarchyCertificate, getHierarchySignaturePayload, encodeHierarchyCertificate, decodeAndVerifyHierarchyCertificate, validateHierarchy, isHierarchyCertificateExpired } from "../../core/HierarchyCertificate.ts";
import { Identity } from "../../core/Identity.ts";
import { buildPurposeHashEnvelope, buildRecipientBoundEnvelope, type SignaturePurpose } from "../../core/MessageHash.ts";
import { sha256Hex } from "../../core/MessageHash.ts";

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const hex = (bytes: Uint8Array) => Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
async function python<T = string>(request: Record<string, string>): Promise<{ result: T; error?: string }> {
  const command = new Deno.Command("python3", {
    args: ["c-core/tests/interop.py"], env: { PYTHONPATH: "python" },
    stdin: "piped", stdout: "piped", stderr: "piped",
  });
  const child = command.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(request)));
  await writer.close();
  const result = await child.output();
  if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

Deno.test("C and TypeScript SHA-256 match", async () => {
  for (const text of ["", "abc", "Unicode ☃ 🔐", "x".repeat(10000)]) {
    assertEquals((await python({ operation: "hash", text })).result, sha256Hex(text));
  }
});

Deno.test("TypeScript and C exchange AES ciphertexts in both directions", async () => {
  for (const text of ["", "hello\0world", "Unicode ☃ 🔐", "x".repeat(10000)]) {
    for (const aad of ["", "ebp:identity-storage:v2"]) {
      const common = { key: hex(key), aad };
      const fromTs = AES.encryptWithKey(key, text, salt, aad);
      assertEquals((await python({ operation: "decrypt", ciphertext: fromTs, ...common })).result, text);
      const fromC = (await python({ operation: "encrypt", text, salt: hex(salt), ...common })).result;
      assertEquals(AES.decryptWithKey(key, fromC, aad), text);
      assertEquals((await python({ operation: "decrypt", ciphertext: fromTs, key: hex(key), aad: "wrong" })).error, "invalid ciphertext");
    }
  }
});

Deno.test("C rejects older ciphertext versions", async () => {
  const encoded = AES.encryptWithKey(key, "legacy", salt);
  for (const version of [1, 2, 3]) {
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    bytes[0] = version;
    const legacy = btoa(String.fromCharCode(...bytes));
    assertEquals((await python({ operation: "decrypt", ciphertext: legacy, key: hex(key), aad: "ignored" })).error, "invalid ciphertext");
  }
});

Deno.test("Argon2id storage keys match TypeScript", async () => {
  for (const password of ["", "password", "Unicode 🔐 café"]) {
    const derived = AES.deriveKeyForStorage(password, salt, 4);
    assertEquals((await python({ operation: "derive", password, salt: hex(salt) })).result, hex(derived));
  }
});

Deno.test("password-based v4 ciphertexts interoperate in both directions", async () => {
  const password = "Unicode 🔐 password", text = "secret ☃", aad = "ebp:identity-storage:v2";
  const fromTs = AES.encrypt(password, text, aad);
  assertEquals((await python({ operation: "decrypt_password", password, ciphertext: fromTs, aad })).result, text);
  const fromC = (await python({ operation: "encrypt_password", password, text, aad })).result;
  assertEquals(AES.decrypt(password, fromC, aad), text);
  assertEquals((await python({ operation: "decrypt_password", password: "wrong", ciphertext: fromTs, aad })).error, "invalid ciphertext");
});

Deno.test("OpenSSL and TypeScript agree on current post-quantum signing keys and signatures", async () => {
  const bytes = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (x) => parseInt(x, 16));
  const message = new TextEncoder().encode("EBP interoperability ☃");
  for (const [algorithm, impl, seedLength] of [[1, ml_dsa87, 32], [2, slh_dsa_sha2_256s, 96]] as const) {
    const seed = Uint8Array.from({ length: seedLength }, (_, i) => i);
    const ts = impl.keygen(seed);
    const c = (await python<{ public: string; private: string }>({ operation: "pq_keygen", algorithm: String(algorithm), seed: hex(seed) })).result;
    assertEquals(c.public, hex(ts.publicKey));
    assertEquals(c.private, hex(ts.secretKey));
    const tsSignature = impl.sign(message, ts.secretKey);
    assertEquals((await python<boolean>({ operation: "pq_verify", algorithm: String(algorithm), public: c.public, message: hex(message), signature: hex(tsSignature) })).result, true);
    const cSignature = (await python({ operation: "pq_sign", algorithm: String(algorithm), private: c.private, message: hex(message) })).result;
    assertEquals(impl.verify(bytes(cSignature), message, ts.publicKey), true);
    assertEquals((await python<boolean>({ operation: "pq_verify", algorithm: String(algorithm), public: c.public, message: "00", signature: cSignature })).result, false);
  }
});

Deno.test("OpenSSL and TypeScript exchange ML-KEM-1024 encapsulations", async () => {
  const bytes = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (x) => parseInt(x, 16));
  const seed = Uint8Array.from({ length: 64 }, (_, i) => i);
  const ts = ml_kem1024.keygen(seed);
  const c = (await python<{ public: string; private: string }>({ operation: "pq_keygen", algorithm: "3", seed: hex(seed) })).result;
  assertEquals(c.public, hex(ts.publicKey));
  assertEquals(c.private, hex(ts.secretKey));
  const fromTs = ml_kem1024.encapsulate(ts.publicKey);
  assertEquals((await python({ operation: "pq_decapsulate", private: c.private, ciphertext: hex(fromTs.cipherText) })).result, hex(fromTs.sharedSecret));
  const fromC = (await python<{ ciphertext: string; secret: string }>({ operation: "pq_encapsulate", public: c.public })).result;
  assertEquals(hex(ml_kem1024.decapsulate(bytes(fromC.ciphertext), ts.secretKey)), fromC.secret);
});

Deno.test("EBP-HD account signing and KEM seeds match TypeScript", async () => {
  const seed = Uint8Array.from({ length: 64 }, (_, i) => i);
  for (const profile of ["dilithium", "sphincs"] as const) {
    for (const [account, change, index] of [[0, "external", 0], [3, "internal", 5], [2147483647, "internal", 2147483647]] as const) {
      const { node } = deriveAccountNode({ seed, profile, account, change, index });
      const ts = deriveIdentitySeeds(node, profile);
      const c = (await python<{ sign: string; kem: string }>({ operation: "hd_identity_seeds", seed: hex(seed), profile, account: String(account), change, index: String(index) })).result;
      assertEquals(c.sign, hex(ts.signingSeed));
      assertEquals(c.kem, hex(ts.encryptionSeed));
    }
  }
});

Deno.test("identity fingerprints agree for current signing profiles", async () => {
  const enc = ml_kem1024.keygen(Uint8Array.from({length: 64}, (_, i) => i)).publicKey;
  for (const [profile, impl, size] of [["dilithium", ml_dsa87, 32], ["sphincs", slh_dsa_sha2_256s, 96]] as const) {
    const signing = impl.keygen(Uint8Array.from({length: size}, (_, i) => i)).publicKey;
    const expected = computeIdentityFingerprint({ signingKeyType: profile, encryptionKeyType: "kyber", signingKey: bytesToBase64(signing), encryptionKey: hex(enc) });
    assertEquals((await python({operation: "fingerprint", profile, signing: hex(signing), encryption: hex(enc)})).result, expected);
  }
});

Deno.test("HD fixture fingerprints match through C derivation and key generation", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("core/tests/fixtures/ebp-hd/test-vectors.json"));
  const vector = fixture.vectors[0];
  for (const testCase of vector.cases.slice(0, 2)) {
    const actual = await python({ operation: "hd_fingerprint", seed: vector.seedHex, profile: testCase.profile, account: "0", change: "external", index: "0" });
    assertEquals(actual.result, testCase.fingerprint);
  }
});

Deno.test("purpose-bound messages and identity signatures interoperate", async () => {
  const identity = new Identity("dilithium", "kyber", { signingSeed: Uint8Array.from({length: 32}, (_, i) => i) });
  const keys = JSON.parse(identity.signingKey.toJSON());
  const fromBase64 = (value: string) => hex(Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0)));
  const text = "message ☃" + String.fromCharCode(0) + "end", salt = "salt:🔐";
  for (const purpose of ["message", "detail-proof", "revocation", "hierarchy"] as SignaturePurpose[]) {
    assertEquals((await python({operation: "envelope", text, salt, purpose})).result, buildPurposeHashEnvelope(purpose, text, salt));
    const tsSig = identity.signMessage(text, salt, purpose);
    assertEquals((await python<boolean>({operation: "verify_message", algorithm: "1", public: fromBase64(keys.publicKey), text, salt, purpose, signature: tsSig})).result, true);
    const cSig = (await python({operation: "sign_message", algorithm: "1", private: fromBase64(keys.secretKey), text, salt, purpose})).result;
    assertEquals(identity.verifyMessage(text, cSig, salt, purpose), true);
    assertEquals(identity.verifyMessage(text + "!", cSig, salt, purpose), false);
  }
});

Deno.test("ML-KEM-1024 encrypted messages interoperate with TypeScript", async () => {
  const tsKey = new KyberEncryptionKey("ml_kem1024", { seed: Uint8Array.from({ length: 64 }, (_, i) => i) });
  const keyData = JSON.parse(tsKey.toJSON());
  for (const text of ["", "Unicode ☃🔐", "hello" + String.fromCharCode(0) + "world"]) {
    const fromTs = tsKey.encrypt(text);
    assertEquals((await python({ operation: "kem_decrypt", private: keyData.secretKey, ciphertext: fromTs })).result, text);
    const fromC = (await python({ operation: "kem_encrypt", public: keyData.publicKey, text })).result;
    assertEquals(tsKey.decrypt(fromC), text);
    const tampered = fromTs.slice(0, -2) + (fromTs.endsWith("00") ? "01" : "00");
    assertEquals((await python({ operation: "kem_decrypt", private: keyData.secretKey, ciphertext: tampered })).error, "invalid ciphertext");
  }
});

Deno.test("single-recipient signatures bind the intended recipient", async () => {
  const identity = new Identity("dilithium", "kyber", { signingSeed: Uint8Array.from({length: 32}, (_, i) => i) });
  const keyData = JSON.parse(identity.signingKey.toJSON());
  const privateKey = hex(Uint8Array.from(atob(keyData.secretKey), (ch) => ch.charCodeAt(0)));
  const publicKey = hex(Uint8Array.from(atob(keyData.publicKey), (ch) => ch.charCodeAt(0)));
  const text = "secret", salt = "salt", recipient = "ebpdk1recipient";
  assertEquals((await python({operation: "recipient_envelope", recipient, text, salt})).result, buildRecipientBoundEnvelope(recipient, text, salt));
  const tsSignature = hex(Uint8Array.from(atob(identity.signMessageForRecipient(text, recipient, salt)), (ch) => ch.charCodeAt(0)));
  assertEquals((await python<boolean>({operation: "verify_recipient", algorithm: "1", public: publicKey, recipient, text, salt, signature: tsSignature})).result, true);
  assertEquals((await python<boolean>({operation: "verify_recipient", algorithm: "1", public: publicKey, recipient: "different", text, salt, signature: tsSignature})).result, false);
  const signatureHex = (await python({operation: "sign_recipient", algorithm: "1", private: privateKey, recipient, text, salt})).result;
  const signature = btoa(String.fromCharCode(...Uint8Array.from(signatureHex.match(/../g) ?? [], (part) => parseInt(part, 16))));
  assertEquals(Identity.VerifyRecipientBoundSignature(identity.summary, recipient, text, signature, salt), true);
  assertEquals(Identity.VerifyRecipientBoundSignature(identity.summary, "another-recipient", text, signature, salt), false);
});

Deno.test("EBP mnemonic vectors and Unicode normalization match", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("core/tests/fixtures/ebp-hd/test-vectors.json"));
  for (const vector of fixture.vectors) {
    assertEquals((await python({operation: "entropy_to_mnemonic", entropy: vector.entropyHex})).result, vector.mnemonic);
    assertEquals((await python({operation: "mnemonic_to_entropy", mnemonic: vector.mnemonic})).result, vector.entropyHex);
    assertEquals((await python({operation: "mnemonic_to_seed", mnemonic: vector.mnemonic, passphrase: vector.passphrase})).result, vector.seedHex);
  }
  for (const size of [16, 20, 24, 28, 32]) {
    const entropy = Uint8Array.from({length: size}, (_, i) => i * 7);
    const mnemonic = entropyToMnemonic(entropy);
    const decorated = "  " + mnemonic.toUpperCase().replaceAll(" ", "\u00a0\t") + " \ufeff";
    assertEquals((await python({operation: "mnemonic_to_entropy", mnemonic: decorated})).result, hex(entropy));
    for (const passphrase of ["é🔐", "e\u0301🔐", "\ufb03"]) {
      assertEquals((await python({operation: "mnemonic_to_seed", mnemonic: decorated, passphrase})).result, hex(mnemonicToSeed(decorated, passphrase)));
    }
  }
  for (const mnemonic of ["", "abandon ".repeat(12).trim(), "ebp000 ".repeat(12).trim(), "abandon ".repeat(11) + "foobar"]) {
    assertEquals((await python({operation: "mnemonic_to_entropy", mnemonic})).error, "invalid ciphertext");
  }
});

Deno.test("C mnemonic wordlist matches the TypeScript BIP39 list", async () => {
  const source = await Deno.readTextFile("c-core/src/bip39_words.inc");
  const words = Array.from(source.matchAll(/"([a-z]+)"/g), (match) => match[1]);
  assertEquals(words, [...BIP39_ENGLISH_WORDLIST]);
});

Deno.test("multi-recipient encryption exchanges content and wrapped keys", async () => {
  const alice = new Identity("dilithium", "kyber", { encryptionSeed: Uint8Array.from({length: 64}, (_, i) => i) });
  const bob = new Identity("dilithium", "kyber", { encryptionSeed: Uint8Array.from({length: 64}, (_, i) => i + 1) });
  const text = "multi-recipient ☃";
  const contentKey = Uint8Array.from({length: 32}, (_, i) => 255 - i);
  const recipients = [alice.summary, bob.summary];
  const fromTs = MultiRecipientCipher.encryptForMany(new TextEncoder().encode(text), [recipients[0], recipients[1], recipients[0]], {contentKey});
  assertEquals(fromTs.recipients.length, 2);
  for (const identity of [alice, bob]) {
    const key = JSON.parse(identity.encryptionKey.toJSON());
    const decrypted = await python({operation: "multi_decrypt", encrypted: JSON.stringify(fromTs), fingerprint: identity.toFingerprint(), private: key.secretKey});
    assertEquals(decrypted.result, text);
  }
  const requestRecipients = recipients.map((entry) => ({fingerprint: entry.fingerprint, public: entry.encryptionKey}));
  requestRecipients.push(requestRecipients[0]);
  type Result = {recipients: typeof fromTs.recipients; ciphertext: string; contentNonce: string; contentKey: string};
  const fromC = (await python<Result>({operation: "multi_encrypt", text, recipients: JSON.stringify(requestRecipients), content_key: hex(contentKey)})).result;
  assertEquals(fromC.recipients.length, 2);
  for (const identity of [alice, bob]) {
    const entry = fromC.recipients.find((v) => v.fingerprint === identity.toFingerprint())!;
    const key = MultiRecipientCipher.unwrapContentKey(entry, identity.encryptionKey as KyberEncryptionKey);
    const plain = MultiRecipientCipher.decryptWithContentKey(fromC.ciphertext, fromC.contentNonce, key);
    assertEquals(new TextDecoder().decode(plain), text);
  }
  const encrypted = {...fromC, ciphertext: fromC.ciphertext.slice(0, -2) + (fromC.ciphertext.endsWith("00") ? "01" : "00")};
  const key = JSON.parse(alice.encryptionKey.toJSON());
  assertEquals((await python({operation: "multi_decrypt", encrypted: JSON.stringify(encrypted), fingerprint: alice.toFingerprint(), private: key.secretKey})).error, "invalid ciphertext");
  assertEquals((await python({operation: "multi_decrypt", encrypted: JSON.stringify(fromC), fingerprint: "not-a-recipient", private: key.secretKey})).error, "invalid ciphertext");
});

Deno.test("current identity storage and signatures exchange in both directions", async () => {
  const password = "storage 🔐 pass", text = "hello from identity", salt = "domain";
  for (const profile of ["dilithium", "sphincs"] as const) {
    type Created = {public: {fingerprint: string}; storage: string; signature: string};
    const c = (await python<Created>({operation: "identity_create", profile, password, text, salt})).result;
    const tsLoaded = Identity.fromStorageFormat(c.storage, password);
    assertEquals(tsLoaded.toFingerprint(), c.public.fingerprint);
    assertEquals(tsLoaded.verifyMessage(text, c.signature, salt), true);
    const ts = new Identity(profile, "kyber");
    ts.attachDetail("name", "Alice ☃");
    const storage = ts.toStorageFormat(password);
    type Loaded = {public: {fingerprint: string; details: unknown}; is_private: boolean; signature: string; storage: string};
    const loaded = (await python<Loaded>({operation: "identity_load", storage, password, text, salt, unlock: "yes", restore: "yes"})).result;
    assertEquals(loaded.public.fingerprint, ts.toFingerprint());
    assertEquals(loaded.public.details, ts.publicData.details);
    assertEquals(loaded.is_private, true);
    assertEquals(ts.verifyMessage(text, loaded.signature, salt), true);
    const restored = Identity.fromStorageFormat(loaded.storage, password);
    assertEquals(restored.toFingerprint(), ts.toFingerprint());
    assertEquals(restored.publicData.details, ts.publicData.details);
    const signature = ts.signMessage(text, salt);
    assertEquals((await python<boolean>({operation: "identity_verify", storage, signature, text, salt})).result, true);
    assertEquals((await python<boolean>({operation: "identity_verify", storage, signature, text: text + "!", salt})).result, false);
    const publicOnly = (await python<Loaded>({operation: "identity_load", storage, unlock: "no"})).result;
    assertEquals(publicOnly.is_private, false);
    assertEquals(publicOnly.public.fingerprint, ts.toFingerprint());
    assertEquals((await python({operation: "identity_load", storage, password: "wrong", unlock: "yes"})).error, "invalid ciphertext");
    const changed = JSON.parse(storage);
    changed.public.fingerprint = "bad";
    assertEquals((await python({operation: "identity_load", storage: JSON.stringify(changed), unlock: "no"})).error, "invalid ciphertext");
    changed.public.fingerprint = ts.toFingerprint();
    changed.version = 1;
    assertEquals((await python({operation: "identity_load", storage: JSON.stringify(changed), password, unlock: "yes"})).error, "invalid ciphertext");
  }
});

Deno.test("identity storage rejects mismatched encrypted and public keys", async () => {
  const password = "identity-password", alice = new Identity("dilithium", "kyber"), bob = new Identity("dilithium", "kyber");
  const storage = JSON.parse(alice.toStorageFormat(password));
  const privateData = JSON.parse(AES.decrypt(password, storage.encrypted, "ebp:identity-storage:v2"));
  privateData.signingKey = bob.signingKey.toJSON();
  storage.encrypted = AES.encrypt(password, JSON.stringify(privateData), "ebp:identity-storage:v2");
  assertEquals((await python({operation: "identity_load", storage: JSON.stringify(storage), password, unlock: "yes"})).error, "invalid ciphertext");
});

Deno.test("other exposed signature variants agree across implementations", async () => {
  const variants = [
    [4, dsaVariants.ml_dsa44, 32], [5, dsaVariants.ml_dsa65, 32],
    [8, slhVariants.slh_dsa_sha2_128f, 48], [9, slhVariants.slh_dsa_sha2_128s, 48],
    [10, slhVariants.slh_dsa_sha2_192f, 72], [11, slhVariants.slh_dsa_sha2_192s, 72],
    [12, slhVariants.slh_dsa_sha2_256f, 96], [13, slhVariants.slh_dsa_shake_128f, 48],
    [14, slhVariants.slh_dsa_shake_128s, 48], [15, slhVariants.slh_dsa_shake_192f, 72],
    [16, slhVariants.slh_dsa_shake_192s, 72], [17, slhVariants.slh_dsa_shake_256f, 96],
    [18, slhVariants.slh_dsa_shake_256s, 96],
  ] as const;
  const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (x) => parseInt(x, 16));
  const message = new TextEncoder().encode("EBP variant compatibility");
  for (const [algorithm, implementation, seedLength] of variants) {
    const seed = Uint8Array.from({length: seedLength}, (_, i) => i);
    const ts = implementation.keygen(seed);
    const c = (await python<{public: string; private: string}>({operation: "pq_keygen", algorithm: String(algorithm), seed: hex(seed)})).result;
    assertEquals(c.public, hex(ts.publicKey));
    assertEquals(c.private, hex(ts.secretKey));
    const signature = implementation.sign(message, ts.secretKey);
    assertEquals((await python<boolean>({operation: "pq_verify", algorithm: String(algorithm), public: c.public, message: hex(message), signature: hex(signature)})).result, true);
    const cSignature = (await python({operation: "pq_sign", algorithm: String(algorithm), private: c.private, message: hex(message)})).result;
    assertEquals(implementation.verify(fromHex(cSignature), message, ts.publicKey), true);
  }
});

Deno.test("other exposed ML-KEM variants exchange encapsulations", async () => {
  const fromHex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (x) => parseInt(x, 16));
  for (const [algorithm, implementation] of [[6, kemVariants.ml_kem512], [7, kemVariants.ml_kem768]] as const) {
    const seed = Uint8Array.from({length: 64}, (_, i) => i);
    const ts = implementation.keygen(seed);
    const c = (await python<{public: string; private: string}>({operation: "pq_keygen", algorithm: String(algorithm), seed: hex(seed)})).result;
    assertEquals(c.public, hex(ts.publicKey));
    assertEquals(c.private, hex(ts.secretKey));
    const fromTs = implementation.encapsulate(ts.publicKey);
    assertEquals((await python({operation: "pq_decapsulate", algorithm: String(algorithm), private: c.private, ciphertext: hex(fromTs.cipherText)})).result, hex(fromTs.sharedSecret));
    const fromC = (await python<{ciphertext: string; secret: string}>({operation: "pq_encapsulate", algorithm: String(algorithm), public: c.public})).result;
    assertEquals(hex(implementation.decapsulate(fromHex(fromC.ciphertext), ts.secretKey)), fromC.secret);
  }
});

Deno.test("ML-KEM-512 and 768 ciphertext formats interoperate", async () => {
  for (const [algorithm, variant] of [[6, "ml_kem512"], [7, "ml_kem768"]] as const) {
    const identity = new KyberEncryptionKey(variant, {seed: Uint8Array.from({length: 64}, (_, i) => i)});
    const keys = JSON.parse(identity.toJSON()), text = "message ☃";
    const tsCipher = identity.encrypt(text);
    assertEquals((await python({operation: "kem_decrypt", algorithm: String(algorithm), private: keys.secretKey, ciphertext: tsCipher})).result, text);
    const cCipher = (await python({operation: "kem_encrypt", algorithm: String(algorithm), public: keys.publicKey, text})).result;
    assertEquals(identity.decrypt(cCipher), text);
  }
});

Deno.test("identity import rejects an inconsistent SLH-DSA private key", async () => {
  const password = "identity-password", identity = new Identity("sphincs", "kyber");
  const storage = JSON.parse(identity.toStorageFormat(password));
  const privateData = JSON.parse(AES.decrypt(password, storage.encrypted, "ebp:identity-storage:v2"));
  const key = JSON.parse(privateData.signingKey);
  const privateBytes = Uint8Array.from(atob(key.secretKey), (ch) => ch.charCodeAt(0));
  privateBytes[0] ^= 1;
  key.secretKey = btoa(String.fromCharCode(...privateBytes));
  privateData.signingKey = JSON.stringify(key);
  storage.encrypted = AES.encrypt(password, JSON.stringify(privateData), "ebp:identity-storage:v2");
  assertEquals((await python({operation: "identity_load", storage: JSON.stringify(storage), password, unlock: "yes"})).error, "invalid ciphertext");
});

Deno.test("multi-recipient encryption supports mixed ML-KEM variants", async () => {
  const variants = ["ml_kem512", "ml_kem768", "ml_kem1024"] as const;
  const keys = variants.map((variant, v) => new KyberEncryptionKey(variant, {seed: Uint8Array.from({length: 64}, (_, i) => i + v)}));
  const identities = keys.map((key, i) => ({
    fingerprint: `recipient-${i}`, encryptionKey: key.publicKey, encryptionKeyType: "kyber" as const,
    encryptionKeyDetails: {variant: variants[i]}, signingKeyType: "dilithium" as const,
    signingKey: "", signingKeyDetails: {variant: "ml_dsa87"}, details: {},
  }));
  const text = "mixed algorithms", contentKey = Uint8Array.from({length: 32}, (_, i) => i);
  const fromTs = MultiRecipientCipher.encryptForMany(new TextEncoder().encode(text), identities, {contentKey});
  for (let i = 0; i < keys.length; i++) {
    const privateKey = JSON.parse(keys[i].toJSON()).secretKey;
    assertEquals((await python({operation: "multi_decrypt", encrypted: JSON.stringify(fromTs), fingerprint: identities[i].fingerprint, private: privateKey})).result, text);
  }
  type Result = {recipients: typeof fromTs.recipients; ciphertext: string; contentNonce: string};
  const recipients = identities.map((entry) => ({fingerprint: entry.fingerprint, public: entry.encryptionKey}));
  const fromC = (await python<Result>({operation: "multi_encrypt", text, recipients: JSON.stringify(recipients), content_key: hex(contentKey)})).result;
  for (let i = 0; i < keys.length; i++) {
    const key = MultiRecipientCipher.unwrapContentKey(fromC.recipients[i], keys[i]);
    assertEquals(new TextDecoder().decode(MultiRecipientCipher.decryptWithContentKey(fromC.ciphertext, fromC.contentNonce, key)), text);
  }
});

Deno.test("current JSON and armored payloads are exchanged without authentication", async () => {
  const payloads = [
    buildSignedMessagePayload({fingerprint: "f", message: "hello ☃", messageHash: "ab", salt: "", signature: "abc"}),
    buildEncryptedSignedMessageMultiPayload({senderFingerprint: "sender", recipients: [{fingerprint: "f", kemCiphertext: "ab", keyWrapNonce: "cd", wrappedContentKey: "ef"}], contentNonce: "00", ciphertext: "aa"}),
  ];
  for (const payload of payloads) {
    const fromTs = armorPayload(payload);
    assertEquals((await python<Record<string, unknown>>({operation: "payload_parse", text: fromTs})).result, JSON.parse(JSON.stringify(payload)));
    const fromC = (await python({operation: "payload_armor", payload: JSON.stringify(payload)})).result;
    assertEquals(parseEbpPayloadInput(fromC), JSON.parse(JSON.stringify(payload)));
  }
  for (const bad of ['{"type":"ebp-signed-message","version":1}', '{"type":"unknown","version":1}', '{"type":"ebp-signed-message","version":2,"version":1}']) {
    assertEquals((await python({operation: "payload_parse", text: bad})).error, "invalid ciphertext");
  }
});

Deno.test("HD identities preserve current fingerprints and provenance across storage", async () => {
  const fixture = JSON.parse(await Deno.readTextFile("core/tests/fixtures/ebp-hd/test-vectors.json"));
  const vector = fixture.vectors[0], seed = Uint8Array.from(vector.seedHex.match(/../g), (v: string) => parseInt(v, 16));
  for (const profile of ["dilithium", "sphincs"] as const) {
    const ts = Identity.fromAccount(seed, {profile, account: 3, change: "internal", index: 5});
    type Result = {public: {fingerprint: string; hdProvenance: unknown}; storage: string};
    const c = (await python<Result>({operation: "identity_hd", seed: vector.seedHex, profile, account: "3", change: "internal", index: "5", password: "password"})).result;
    assertEquals(c.public.fingerprint, ts.toFingerprint());
    assertEquals(c.public.hdProvenance, ts.publicData.hdProvenance);
    const restored = Identity.fromStorageFormat(c.storage, "password");
    assertEquals(restored.toFingerprint(), ts.toFingerprint());
    assertEquals(restored.publicData.hdProvenance, ts.publicData.hdProvenance);
  }
});

Deno.test("signed detail proofs interoperate without accepting tampered details", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret", path = "email", detail = "test+☃@example.org";
  identity.attachDetail(path, detail);
  const [_, proof] = identity.details.get(path)!;
  const publicHex = hex(Uint8Array.from(atob(identity.publicKeys.signingKey), (ch) => ch.charCodeAt(0)));
  const verified = (await python<number[]>({operation: "verify_detail_proof", algorithm: "1", public: publicHex, path, detail, proof})).result;
  assertEquals(verified[0], 0);
  assertEquals((await python({operation: "verify_detail_proof", algorithm: "1", public: publicHex, path, detail: detail + "x", proof})).result, null);
  const cProof = (await python({operation: "create_detail_proof", storage: identity.toStorageFormat(password), password, path, detail, nonce: "7", timestamp: "1700000000123"})).result;
  const cVerified = verifyDetailProof({signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, signingVariant: "ml_dsa87", path, detail, proof: cProof});
  assertEquals(cVerified, {ok: true, record: {nonce: 7, timestamp: 1700000000123}});
});

Deno.test("detail proof canonicalization handles Unicode and control characters", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret";
  const path = "quote/\"\\" + String.fromCharCode(0) + "\u2028";
  const detail = "emoji 🔐 / newline\n" + String.fromCharCode(0) + "é";
  const cleanStorage = identity.toStorageFormat(password);
  identity.attachDetail(path, detail);
  const proof = identity.details.get(path)![1];
  const pub = hex(Uint8Array.from(atob(identity.publicKeys.signingKey), (ch) => ch.charCodeAt(0)));
  const verified = (await python<number[]>({operation: "verify_detail_proof", algorithm: "1", public: pub, path, detail, proof})).result;
  assertEquals(verified[0], 0);
  const cProof = (await python({operation: "create_detail_proof", storage: cleanStorage, password, path, detail, nonce: "1", timestamp: "1700000000000"})).result;
  assertEquals(verifyDetailProof({signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, signingVariant: "ml_dsa87", path, detail, proof: cProof}), {ok: true, record: {nonce: 1, timestamp: 1700000000000}});
});

Deno.test("identity storage rejects detail keys containing embedded NUL", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "storage-password";
  identity.attachDetail("key" + String.fromCharCode(0) + "suffix", "value");
  const storage = identity.toStorageFormat(password);
  assertEquals((await python({operation: "identity_load", storage, password, unlock: "yes"})).error, "invalid ciphertext");
});

Deno.test("revocation certificates interoperate and bind identity and target", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret", storage = identity.toStorageFormat(password);
  const target = "email/☃", reason = "rotation 🔐";
  for (const kind of ["identity", "detail"] as const) {
    const cert = createRevocationCertificate(kind, identity.toFingerprint(), 4, {reason, ...(kind === "detail" ? {target} : {})});
    cert.signature = identity.signMessage(getRevocationSignaturePayload(cert), undefined, "revocation");
    const encoded = encodeRevocationCertificate({...cert, signature: cert.signature});
    assertEquals((await python<boolean>({operation: "verify_revocation", storage, certificate: encoded, expected_type: kind, ...(kind === "detail" ? {expected_target: target} : {})})).result, true);
    if (kind === "detail") {
      assertEquals((await python<boolean>({operation: "verify_revocation", storage, certificate: encoded, expected_type: kind, expected_target: "different"})).result, false);
    }
    const c = (await python({operation: "create_revocation", storage, password, revocation_type: kind, nonce: "4", timestamp: "1700000000000", reason, ...(kind === "detail" ? {target} : {})})).result;
    const result = decodeAndVerifyRevocationCertificate(c, {signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, variant: "ml_dsa87", expectedType: kind, expectedFingerprint: identity.toFingerprint(), ...(kind === "detail" ? {expectedTarget: target} : {})});
    assertEquals(result.ok, true);
  }
});

Deno.test("hierarchy certificates exchange and bind both identities", async () => {
  const master = new Identity("dilithium", "kyber"), child = new Identity("sphincs", "kyber"), password = "secret";
  const masterStorage = master.toStorageFormat(password), childStorage = child.toStorageFormat(password);
  const timestamp = 1700000000000, expiry = 1700000001000, context = "team ☃", salt = "salt";
  const cert = createHierarchyCertificate(master.toFingerprint(), child.toFingerprint(), {timestamp, expiry, context, salt});
  const payload = getHierarchySignaturePayload(cert);
  cert.masterSignature = master.signMessage(payload, undefined, "hierarchy");
  cert.childSignature = child.signMessage(payload, undefined, "hierarchy");
  const encoded = encodeHierarchyCertificate({...cert, masterSignature: cert.masterSignature, childSignature: cert.childSignature});
  assertEquals((await python<boolean>({operation: "verify_hierarchy", master: masterStorage, child: childStorage, certificate: encoded})).result, true);
  assertEquals((await python<boolean>({operation: "verify_hierarchy", master: childStorage, child: masterStorage, certificate: encoded})).result, false);
  const c = (await python({operation: "create_hierarchy", master: masterStorage, child: childStorage, password, timestamp: String(timestamp), expiry: String(expiry), context, salt})).result;
  assertEquals(decodeAndVerifyHierarchyCertificate(c, master.summary, child.summary).ok, true);
  const tampered = JSON.parse(new TextDecoder().decode(Uint8Array.from(c.match(/../g) ?? [], (part) => parseInt(part, 16))));
  tampered.context = "changed";
  const altered = hex(new TextEncoder().encode(JSON.stringify(tampered)));
  assertEquals((await python<boolean>({operation: "verify_hierarchy", master: masterStorage, child: childStorage, certificate: altered})).result, false);
});

Deno.test("recipient-bound signed encryption exchanges with TypeScript identities", async () => {
  const sender = new Identity("dilithium", "kyber"), recipient = new Identity("dilithium", "kyber"), outsider = new Identity("dilithium", "kyber");
  const password = "secret", text = "signed ☃" + String.fromCharCode(0) + "message";
  const senderStorage = sender.toStorageFormat(password), recipientStorage = recipient.toStorageFormat(password), outsiderStorage = outsider.toStorageFormat(password);
  const fromTs = sender.signAndEncryptMessage(text, recipient);
  type Result = {message: string; verified: boolean; verifyStatus: string};
  const c = (await python<Result>({operation: "identity_decrypt_verify", recipient: recipientStorage, sender: senderStorage, password, ciphertext: fromTs})).result;
  assertEquals(c, {message: text, verified: true, verifyStatus: "valid"});
  const wrongSender = (await python<Result>({operation: "identity_decrypt_verify", recipient: recipientStorage, sender: outsiderStorage, password, ciphertext: fromTs})).result;
  assertEquals(wrongSender, {message: text, verified: false, verifyStatus: "invalid"});
  const forwarded = outsider.encryptionKey.encrypt(recipient.encryptionKey.decrypt(fromTs));
  const forwardedResult = (await python<Result>({operation: "identity_decrypt_verify", recipient: outsiderStorage, sender: senderStorage, password, ciphertext: forwarded})).result;
  assertEquals(forwardedResult, {message: text, verified: false, verifyStatus: "invalid"});
  const fromC = (await python({operation: "identity_sign_encrypt", sender: senderStorage, recipient: recipientStorage, password, text})).result;
  assertEquals(recipient.decryptAndVerify(fromC, sender.summary), {message: text, verified: true, verifyStatus: "valid"});
  assertEquals(recipient.decryptAndVerify(fromC, outsider.summary), {message: text, verified: false, verifyStatus: "invalid"});
  const tampered = fromC.slice(0, -2) + (fromC.endsWith("00") ? "01" : "00");
  assertEquals((await python({operation: "identity_decrypt_verify", recipient: recipientStorage, sender: senderStorage, password, ciphertext: tampered})).error, "invalid ciphertext");
});

Deno.test("attached identity details round-trip and verify across implementations", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret";
  identity.attachDetail("email", "first@example.org");
  const storage = identity.toStorageFormat(password);
  assertEquals((await python({operation: "identity_get_detail", storage, path: "email"})).result, "first@example.org");
  type Updated = {storage: string; detail: string; public: {detailsNonce: number}};
  const updated = (await python<Updated>({operation: "identity_attach_detail", storage, password, path: "name", detail: "Alice ☃", timestamp: "1800000000000"})).result;
  assertEquals(updated.detail, "Alice ☃");
  assertEquals(updated.public.detailsNonce, 2);
  const loaded = Identity.fromStorageFormat(updated.storage, password);
  assertEquals(loaded.getDetail("name"), "Alice ☃");
  assertEquals(loaded.getDetail("email"), "first@example.org");
  assertEquals(loaded.verifyDetails(), true);
  const tampered = JSON.parse(updated.storage);
  tampered.public.details.name[0] = "Mallory";
  assertEquals((await python({operation: "identity_get_detail", storage: JSON.stringify(tampered), path: "name"})).result, null);
});

Deno.test("revocations update identity state across implementations", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret", path = "email";
  identity.attachDetail(path, "alice@example.org");
  const storage = identity.toStorageFormat(password);
  type Result = {certificate: string; storage: string; is_revoked: boolean; detail_revoked: boolean};
  const detail = (await python<Result>({operation: "identity_revoke", storage, password, kind: "detail", path, reason: "changed", timestamp: "1800000000000"})).result;
  const afterDetail = Identity.fromStorageFormat(detail.storage, password);
  assertEquals(detail.detail_revoked, true);
  assertEquals(afterDetail.isDetailRevoked(path), true);
  assertEquals(afterDetail.getDetail(path), null);
  assertEquals(decodeAndVerifyRevocationCertificate(detail.certificate, {signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, variant: "ml_dsa87", expectedType: "detail", expectedTarget: path, expectedFingerprint: identity.toFingerprint()}).ok, true);
  const revoked = (await python<Result>({operation: "identity_revoke", storage: detail.storage, password, kind: "identity", reason: "retired", timestamp: "1800000001000"})).result;
  const afterIdentity = Identity.fromStorageFormat(revoked.storage, password);
  assertEquals(revoked.is_revoked, true);
  assertEquals(afterIdentity.isRevoked(), true);
  assertEquals(afterIdentity.revocationNonce, 2);
  assertEquals(decodeAndVerifyRevocationCertificate(revoked.certificate, {signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, variant: "ml_dsa87", expectedType: "identity", expectedFingerprint: identity.toFingerprint()}).ok, true);
});

Deno.test("hierarchy graph and expiration checks match TypeScript", async () => {
  type Pair = [string, string];
  const cases: {edges: Pair[]; proposed?: Pair}[] = [
    {edges: []}, {edges: [["a", "b"], ["b", "c"]]},
    {edges: [["a", "b"], ["b", "a"]]}, {edges: [["a", "a"]]},
    {edges: [["a", "b"], ["c", "b"]]},
    {edges: [["a", "b"], ["b", "c"]], proposed: ["c", "a"]},
    {edges: [["a", "b"]], proposed: ["c", "b"]},
    {edges: [["a", "b"]], proposed: ["b", "c"]},
    {edges: [["a", "b"], ["b", "a"]], proposed: ["x", "y"]},
  ];
  for (const {edges, proposed} of cases) {
    const map = (e: Pair) => ({masterFingerprint: e[0], childFingerprint: e[1]});
    const ts = validateHierarchy(edges.map(map), proposed ? map(proposed) : undefined).ok;
    const c = (await python<boolean>({operation: "validate_hierarchy", edges: JSON.stringify(edges), ...(proposed ? {proposed: JSON.stringify(proposed)} : {})})).result;
    assertEquals(c, ts);
  }
  for (const [expiry, now] of [[0, 10], [10, 9], [10, 10], [10, 11]]) {
    assertEquals((await python<boolean>({operation: "hierarchy_expired", expiry: String(expiry), now: String(now)})).result, isHierarchyCertificateExpired({expiry}, now));
  }
});

Deno.test("public identity exports verify and receive encrypted messages", async () => {
  const sender = new Identity("dilithium", "kyber"), recipient = new Identity("dilithium", "kyber"), password = "secret", text = "for a public contact";
  const publicSender = JSON.stringify(sender.toPublicExport());
  const signature = sender.signMessage(text);
  assertEquals((await python<boolean>({operation: "public_identity_verify", public: publicSender, text, signature, salt: ""})).result, true);
  const publicRecipient = JSON.stringify(recipient.toPublicExport());
  const cipher = (await python({operation: "public_identity_encrypt", sender: sender.toStorageFormat(password), password, public: publicRecipient, text})).result;
  assertEquals(recipient.decryptAndVerify(cipher, sender.summary), {message: text, verified: true, verifyStatus: "valid"});
  const incomplete = JSON.stringify(recipient.toPublicExport({includeSigningKey: false}));
  assertEquals((await python({operation: "public_identity_encrypt", sender: sender.toStorageFormat(password), password, public: incomplete, text})).error, "invalid ciphertext");
});

Deno.test("file cleartext envelopes exchange bytes and metadata", async () => {
  const data = Uint8Array.from({length: 256}, (_, i) => i), name = "report ☃" + String.fromCharCode(0) + ".bin", mime = "application/octet-stream";
  const ts = createFileCleartextEnvelope(data, name, mime);
  type FileResult = {fileBytes: string; fileName: string; mimeType: string; fileSize: number};
  const parsed = (await python<FileResult>({operation: "file_parse", text: JSON.stringify(ts)})).result;
  assertEquals(parsed, {fileBytes: hex(data), fileName: name, mimeType: mime, fileSize: data.length});
  const fromC = (await python<Record<string, unknown>>({operation: "file_create", file: hex(data), name, mime})).result;
  const restored = parseFileCleartextEnvelope(JSON.stringify(fromC));
  assertEquals(restored.fileBytes, data);
  assertEquals(restored.fileName, name);
  assertEquals(restored.mimeType, mime);
  for (const bad of [{...ts, version: 0}, {...ts, fileSize: data.length+1}, {...ts, fileDataBase64: ""}, {...ts, fileDataBase64: "!!!"}]) {
    assertEquals((await python({operation: "file_parse", text: JSON.stringify(bad)})).error, "invalid ciphertext");
  }
});

Deno.test("file envelope parsing follows TypeScript base64 rules", async () => {
  for (const encoded of ["TWE", "T W E=", " Zg==\n", " "]) {
    const fileBytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0));
    const envelope = {type: "ebp-file-cleartext-envelope", version: 1, fileName: "f", mimeType: "x", fileSize: fileBytes.length, fileDataBase64: encoded};
    const expected = parseFileCleartextEnvelope(JSON.stringify(envelope));
    const actual = (await python<{fileBytes: string}>({operation: "file_parse", text: JSON.stringify(envelope)})).result;
    assertEquals(actual.fileBytes, hex(expected.fileBytes));
  }
});
