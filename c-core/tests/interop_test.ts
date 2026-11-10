import { deepStrictEqual as assertEquals, throws as assertThrows } from "node:assert/strict";
import * as dsaVariants from "@noble/post-quantum/ml-dsa";
import * as slhVariants from "@noble/post-quantum/slh-dsa";
import * as kemVariants from "@noble/post-quantum/ml-kem";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem";
import { slh_dsa_sha2_256s } from "@noble/post-quantum/slh-dsa";
import { deriveAccountNode, deriveIdentitySeeds, deriveNode } from "../../core/Hd.ts";
import { computeIdentityFingerprint } from "../../core/Fingerprint.ts";
import { bytesToBase64 } from "../../core/Base64.ts";
import { BIP39_ENGLISH_WORDLIST } from "../../core/bip39-english.ts";
import { entropyToMnemonic, mnemonicToSeed } from "../../core/Mnemonic.ts";
import { armorPayload, buildDetachedSignaturePayload, buildSignedMessagePayload, buildEncryptedMessagePayload, buildEncryptedSignedMessagePayload, buildEncryptedSignedMessageMultiPayload } from "../../core/Payloads.ts";
import { parseEbpPayloadInput } from "../../core/PayloadInput.ts";
import { createFileCleartextEnvelope, parseFileCleartextEnvelope, buildEncryptedFilePayload, buildEncryptedSignedFilePayload } from "../../core/FilePayload.ts";
import { createEmailAttachmentCleartextEnvelope, parseEmailAttachmentCleartextEnvelope, parseEncryptedEmailAttachmentPayload } from "../../core/EmailAttachmentPayload.ts";
import { parseHdPath } from "../../core/HdPath.ts";
import { AES } from "../../core/AES.ts";
import { MultiRecipientCipher } from "../../core/MultiRecipientCipher.ts";
import { KyberEncryptionKey } from "../../core/Kyber.ts";
import { verifyDetailProof } from "../../core/DetailProof.ts";
import { createRevocationCertificate, getRevocationSignaturePayload, encodeRevocationCertificate, decodeAndVerifyRevocationCertificate } from "../../core/Revocation.ts";
import { createHierarchyCertificate, getHierarchySignaturePayload, encodeHierarchyCertificate, decodeAndVerifyHierarchyCertificate, validateHierarchy, isHierarchyCertificateExpired } from "../../core/HierarchyCertificate.ts";
import { Identity } from "../../core/Identity.ts";
import { buildPurposeHashEnvelope, buildRecipientBoundEnvelope, buildMultiRecipientBoundEnvelope, type SignaturePurpose } from "../../core/MessageHash.ts";
import { sha256Hex } from "../../core/MessageHash.ts";
import { canonicalJsonStringify } from "../../core/CanonicalJson.ts";
import { parseStrictJson } from "../../core/StrictJson.ts";
import { computeStateHash } from "../../core/StateHash.ts";

const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const hex = (bytes: Uint8Array) => Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("");
async function python<T = string>(request: Record<string, string>): Promise<{ result: T; error?: string }> {
  const env: Record<string, string> = {
    PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    PYTHONPATH: "python",
    PYTHONUTF8: "1",
  };
  const library = Deno.env.get("EBP_CORE_LIBRARY");
  if (library) env.EBP_CORE_LIBRARY = library;
  const command = new Deno.Command("python3", {
    args: ["c-core/tests/interop.py"], clearEnv: true, env,
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

Deno.test("Python bridge loads the intended OpenSSL library", async () => {
  const version = (await python({ operation: "openssl_version" })).result;
  const expected = Deno.env.get("EBP_EXPECT_OPENSSL_VERSION") ?? "OpenSSL ";
  if (!version.startsWith(expected)) throw new Error(`Expected ${expected}, loaded ${version}`);
});

Deno.test("RFC 8785 canonical JSON and state hashes agree", async () => {
  const examples: unknown[] = [
    {numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27], string: "€$\u000f\nA'B\"\\\"/", literals: [null, true, false]},
    {"2": true, "10": false, "\u20ac": 1, "\r": 2, "\ufb33": 3, "😀": 4, "\u0080": 5, "ö": 6},
    [0, -0, 1e-6, 1e-7, 1e20, 1e21, 1.7976931348623157e308, 5e-324, 9007199254740992],
  ];
  for (const value of examples) {
    const actual = (await python<string>({operation: "canonical_json", text: JSON.stringify(value)})).result;
    assertEquals(actual, canonicalJsonStringify(value));
  }
  const state = {fingerprint: "f", signingKeyType: "dilithium", encryptionKeyType: "kyber", signingKey: "s", encryptionKey: "e", details: {}};
  const serialized = (await python<string>({operation: "canonical_json", text: JSON.stringify(state)})).result;
  assertEquals(computeStateHash(state), sha256Hex(serialized));
  for (const text of ['{"a":1,"a":2}', '{"\\u0000":0}', '"\\ud800"', '1e999']) {
    assertThrows(() => parseStrictJson(text));
    assertEquals((await python({operation: "canonical_json", text})).error, "invalid ciphertext");
  }
});

Deno.test("RFC 8785 Appendix B binary64 examples match", async () => {
  const samples = [
    ["0000000000000000", "0"], ["8000000000000000", "0"], ["0000000000000001", "5e-324"], ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"], ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"], ["c340000000000000", "-9007199254740992"], ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"], ["44b52d02c7e14af6", "1e+23"], ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"], ["444b1ae4d6e2ef4f", "999999999999999900000"], ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"], ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"], ["41b3de4355555554", "333333333.33333325"], ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"], ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"], ["43143ff3c1cb0959", "1424953923781206.2"],
  ];
  const view = new DataView(new ArrayBuffer(8));
  const values = samples.map(([bits]) => { view.setBigUint64(0, BigInt(`0x${bits}`)); return view.getFloat64(0); });
  const expected = `[${samples.map(([, text]) => text).join(",")}]`;
  assertEquals(canonicalJsonStringify(values), expected);
  assertEquals((await python({operation: "canonical_json", text: JSON.stringify(values)})).result, expected);
});

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
  const encryptionKey = hex(ml_kem1024.keygen(Uint8Array.from({length: 64}, (_, i) => i)).publicKey);
  const names: Record<number, string> = {4: "ml_dsa44", 5: "ml_dsa65", 8: "slh_dsa_sha2_128f", 9: "slh_dsa_sha2_128s", 10: "slh_dsa_sha2_192f", 11: "slh_dsa_sha2_192s", 12: "slh_dsa_sha2_256f", 13: "slh_dsa_shake_128f", 14: "slh_dsa_shake_128s", 15: "slh_dsa_shake_192f", 16: "slh_dsa_shake_192s", 17: "slh_dsa_shake_256f", 18: "slh_dsa_shake_256s"};
  for (const [algorithm, implementation, seedLength] of variants) {
    const seed = Uint8Array.from({length: seedLength}, (_, i) => i);
    const ts = implementation.keygen(seed);
    const signingKeyType = algorithm < 8 ? "dilithium" : "sphincs", signingKey = bytesToBase64(ts.publicKey);
    const fingerprint = computeIdentityFingerprint({signingKeyType, encryptionKeyType: "kyber", signingKey, encryptionKey});
    const publicData = {fingerprint, signingKeyType, encryptionKeyType: "kyber", signingKey, encryptionKey, signingKeyDetails: {variant: names[algorithm]}, encryptionKeyDetails: {variant: "ml_kem1024"}};
    assertEquals((await python({operation: "public_identity_import", public: JSON.stringify(publicData)})).result, fingerprint);
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
    buildDetachedSignaturePayload({fingerprint: "f", messageHash: "ab", salt: "", signature: "abc", identity: {name: "snow ☃"}}),
    buildSignedMessagePayload({fingerprint: "f", message: "hello ☃", messageHash: "ab", salt: "", signature: "abc"}),
    buildEncryptedMessagePayload({recipientFingerprint: "r", ciphertext: "aabb"}),
    buildEncryptedSignedMessagePayload({recipientFingerprint: "r", senderFingerprint: "s", ciphertext: "aabb", senderIdentity: {name: "sender"}}),
    buildEncryptedSignedMessageMultiPayload({senderFingerprint: "sender", recipients: [{fingerprint: "f", kemCiphertext: "ab", keyWrapNonce: "cd", wrappedContentKey: "ef"}], contentNonce: "00", ciphertext: "aa"}),
    buildEncryptedFilePayload({recipientFingerprint: "r", fileName: "f", mimeType: "text/plain", fileSize: 3, ciphertext: "aabb"}),
    buildEncryptedSignedFilePayload({recipientFingerprint: "r", senderFingerprint: "s", fileName: "f", mimeType: "text/plain", fileSize: 3, ciphertext: "aabb"}),
  ];
  for (const payload of payloads) {
    assertEquals((await python({operation: "payload_build", type: payload.type, fields: JSON.stringify(payload)})).result, JSON.parse(JSON.stringify(payload)));
    const fromTs = armorPayload(payload);
    assertEquals((await python<Record<string, unknown>>({operation: "payload_parse", text: fromTs})).result, JSON.parse(JSON.stringify(payload)));
    const fromC = (await python({operation: "payload_armor", payload: JSON.stringify(payload)})).result;
    assertEquals(parseEbpPayloadInput(fromC), JSON.parse(JSON.stringify(payload)));
  }
  for (const bad of ['{"type":"ebp-signed-message","version":1}', '{"type":"unknown","version":1}', '{"type":"ebp-encrypted-signed-message-multi","version":1}', '{"type":"ebp-signed-message","version":2,"version":1}']) {
    assertThrows(() => parseEbpPayloadInput(bad));
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
  const oldRecord = JSON.parse(new TextDecoder().decode(Uint8Array.from(proof.match(/../g) ?? [], (part) => parseInt(part, 16))));
  const numericProof = hex(new TextEncoder().encode(JSON.stringify(oldRecord).replace('"version":2', '"version":2.0').replace('"nonce":0', '"nonce":0.0')));
  assertEquals((await python<number[]>({operation: "verify_detail_proof", algorithm: "1", public: publicHex, path, detail, proof: numericProof})).result[0], 0);
  delete oldRecord.version;
  const oldProof = hex(new TextEncoder().encode(JSON.stringify(oldRecord)));
  assertEquals((await python({operation: "verify_detail_proof", algorithm: "1", public: publicHex, path, detail, proof: oldProof})).result, null);
  assertEquals(verifyDetailProof({signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, signingVariant: "ml_dsa87", path, detail, proof: oldProof}).ok, false);
  assertEquals((await python({operation: "verify_detail_proof", algorithm: "1", public: publicHex, path, detail: detail + "x", proof})).result, null);
  const cProof = (await python({operation: "create_detail_proof", storage: identity.toStorageFormat(password), password, path, detail, nonce: "7", timestamp: "1700000000123"})).result;
  const cVerified = verifyDetailProof({signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, signingVariant: "ml_dsa87", path, detail, proof: cProof});
  assertEquals(cVerified, {ok: true, record: {nonce: 7, timestamp: 1700000000123}});
});

Deno.test("detail proof canonicalization handles Unicode and control characters", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret";
  const path = "quote/\"\\" + "\u2028";
  const detail = "emoji 🔐 / newline\n" + String.fromCharCode(0, 15, 31) + " literal\\u001F é";
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
  assertThrows(() => identity.attachDetail("key" + String.fromCharCode(0) + "suffix", "value"));
  const parsed = JSON.parse(identity.toStorageFormat(password));
  parsed.public.details["key" + String.fromCharCode(0) + "suffix"] = ["value", "proof"];
  const storage = JSON.stringify(parsed);
  assertEquals((await python({operation: "identity_load", storage, password, unlock: "yes"})).error, "invalid ciphertext");
});

Deno.test("revocation certificates interoperate and bind identity and target", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "secret", storage = identity.toStorageFormat(password);
  const target = "email/☃", reason = "rotation 🔐" + String.fromCharCode(31) + " literal\\u001F";
  for (const kind of ["identity", "detail"] as const) {
    const cert = createRevocationCertificate(kind, identity.toFingerprint(), 4, {reason, ...(kind === "detail" ? {target} : {})});
    cert.signature = identity.signMessage(getRevocationSignaturePayload(cert), undefined, "revocation");
    const encoded = encodeRevocationCertificate({...cert, signature: cert.signature});
    assertEquals((await python<boolean>({operation: "verify_revocation", storage, certificate: encoded, expected_type: kind, ...(kind === "detail" ? {expected_target: target} : {})})).result, true);
    const old = {...cert} as Record<string, unknown>;
    delete old.version;
    const oldEncoded = hex(new TextEncoder().encode(JSON.stringify(old)));
    assertEquals((await python<boolean>({operation: "verify_revocation", storage, certificate: oldEncoded, expected_type: kind})).result, false);
    assertEquals(decodeAndVerifyRevocationCertificate(oldEncoded, {signingKeyType: "dilithium", signingKey: identity.publicKeys.signingKey, variant: "ml_dsa87"}).ok, false);
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
  const timestamp = 1700000000000, expiry = 1700000001000, context = "team ☃" + String.fromCharCode(15) + " literal\\u000F", salt = "salt";
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

Deno.test("staged hierarchy and revocation signing interoperates", async () => {
  const master = new Identity("dilithium", "kyber"), child = new Identity("dilithium", "kyber"), password = "secret", timestamp = 1700000000000;
  const result = (await python<{unsigned: Record<string, unknown>; payload: string; draft: string; encoded: string; decoded: Record<string, unknown>}>({
    operation: "hierarchy_staged", master: master.toStorageFormat(password), child: child.toStorageFormat(password), password,
    timestamp: String(timestamp), expiry: "0", context: "team", salt: "salt",
  })).result;
  const expected = createHierarchyCertificate(master.toFingerprint(), child.toFingerprint(), {timestamp, expiry: 0, context: "team", salt: "salt"});
  assertEquals(result.unsigned, expected);
  assertEquals(result.payload, getHierarchySignaturePayload(expected));
  const draft = JSON.parse(new TextDecoder().decode(Uint8Array.from(result.draft.match(/../g) ?? [], (part) => parseInt(part, 16))));
  assertEquals(draft.childSignature, null);
  assertEquals(master.verifyMessage(result.payload, draft.masterSignature, undefined, "hierarchy"), true);
  assertEquals(decodeAndVerifyHierarchyCertificate(result.encoded, master.summary, child.summary).ok, true);
  assertEquals(result.decoded.version, 2);
  const rev = (await python<{unsigned: Record<string, unknown>; payload: string; encoded: string; decoded: Record<string, unknown>}>({operation: "revocation_staged", storage: master.toStorageFormat(password), password, timestamp: String(timestamp)})).result;
  const expectedRev = {...createRevocationCertificate("identity", master.toFingerprint(), 3, {reason: "rotation"}), timestamp};
  assertEquals(rev.unsigned, JSON.parse(JSON.stringify(expectedRev)));
  assertEquals(rev.payload, getRevocationSignaturePayload(expectedRev));
  assertEquals(decodeAndVerifyRevocationCertificate(rev.encoded, {signingKeyType: "dilithium", signingKey: master.publicKeys.signingKey, variant: "ml_dsa87"}).ok, true);
  assertEquals(rev.decoded.version, 2);
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
  const encryptionOnly = recipient.toPublicExport({includeSigningKey: false});
  const partialCipher = (await python({operation: "public_identity_encrypt", sender: sender.toStorageFormat(password), password, public: JSON.stringify(encryptionOnly), text})).result;
  assertEquals(recipient.decryptAndVerify(partialCipher, sender.summary), {message: text, verified: true, verifyStatus: "valid"});
  const signingOnly = sender.toPublicExport({includeEncryptionKey: false});
  assertEquals((await python<boolean>({operation: "public_identity_verify", public: JSON.stringify(signingOnly), text, signature, salt: ""})).result, true);
  assertEquals((await python({operation: "public_identity_encrypt", sender: sender.toStorageFormat(password), password, public: JSON.stringify(signingOnly), text})).error, "invalid ciphertext");
  for (const invalid of [
    {...encryptionOnly, signingKeyHash: "00".repeat(32)},
    {...sender.toPublicExport(), signingKeyHash: "00".repeat(32)},
    {...encryptionOnly, encryptionKey: undefined, encryptionKeyHash: "00".repeat(32)},
  ]) {
    assertEquals((await python({operation: "public_identity_verify", public: JSON.stringify(invalid), text, signature, salt: ""})).error, "invalid ciphertext");
  }
});

Deno.test("public identity export options match TypeScript", async () => {
  const identity = new Identity("dilithium", "kyber"), storage = identity.toStorageFormat("password");
  for (const [signing, encryption, details] of [[true, true, true], [true, false, false], [false, true, true]] as const) {
    const actual = (await python({operation: "identity_export_options", storage, signing: signing ? "yes" : "no", encryption: encryption ? "yes" : "no", details: details ? "yes" : "no"})).result;
    assertEquals(actual, identity.toPublicExport({includeSigningKey: signing, includeEncryptionKey: encryption, includeDetails: details}));
  }
});

Deno.test("identity storage with derived keys interoperates", async () => {
  const identity = new Identity("dilithium", "kyber"), password = "password", storage = identity.toStorageFormat(password);
  const ts = identity.toStorageFormatWithKey(key, salt);
  assertEquals((await python({operation: "identity_load_with_key", storage: ts, key: hex(key)})).result, identity.toFingerprint());
  const c = (await python({operation: "identity_storage_with_key", storage, password, key: hex(key), salt: hex(salt)})).result;
  assertEquals(Identity.fromStorageFormatWithKey(c, key).toFingerprint(), identity.toFingerprint());
  assertEquals((await python({operation: "identity_load_with_key", storage: ts, key: hex(new Uint8Array(32))})).error, "invalid ciphertext");
});

Deno.test("non-default identity key variants interoperate", async () => {
  const password = "password", message = "variant interoperability";
  for (const [signing, kem] of [[4, 6], [5, 7], [8, 6], [14, 7]]) {
    const created = (await python<{storage: string; signature: string}>({operation: "identity_variants", signing: String(signing), kem: String(kem), password, message})).result;
    const ts = Identity.fromStorageFormat(created.storage, password);
    assertEquals(ts.verifyMessage(message, created.signature), true);
    const signature = ts.signMessage(message);
    assertEquals((await python<boolean>({operation: "public_identity_verify", public: JSON.stringify(ts.toPublicExport()), text: message, signature, salt: ""})).result, true);
    const c = (await python({operation: "identity_sign_encrypt", sender: created.storage, recipient: created.storage, password, text: message})).result;
    assertEquals(ts.decryptAndVerify(c, ts.summary).verified, true);
    const fromTs = ts.signAndEncryptMessage(message, ts);
    assertEquals((await python<{verified: boolean}>({operation: "identity_decrypt_verify", recipient: created.storage, sender: created.storage, password, ciphertext: fromTs})).result.verified, true);
  }
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

Deno.test("email attachment formats interoperate and validate fields", async () => {
  const fileBytes = Uint8Array.from({length: 32}, (_, i) => i), fileName = "report ☃.txt", mimeType = "text/plain", attachmentId = "a-123", bodyPayloadHash = "0123";
  const ts = createEmailAttachmentCleartextEnvelope({fileBytes, fileName, mimeType, attachmentId, bodyPayloadHash});
  const c = (await python({operation: "email_attachment_create", file: hex(fileBytes), name: fileName, id: attachmentId, mime: mimeType, body: bodyPayloadHash})).result;
  assertEquals(c, ts);
  const actual = (await python({operation: "email_attachment_parse", text: JSON.stringify(ts)})).result;
  assertEquals(actual, {...parseEmailAttachmentCleartextEnvelope(JSON.stringify(ts)), fileBytes: hex(fileBytes)});
  for (const payload of [
    {type: "ebp-encrypted-email-attachment", version: 1, recipientFingerprint: "r", attachmentId, ciphertext: "a"},
    {type: "ebp-encrypted-signed-email-attachment", version: 1, recipientFingerprint: "r", senderFingerprint: "s", attachmentId, ciphertext: "a"},
    {type: "ebp-encrypted-signed-email-attachment-multi", version: 1, senderFingerprint: "s", attachmentId, contentNonce: "b", ciphertext: "a"},
  ]) {
    assertEquals((await python({operation: "encrypted_email_attachment_parse", text: JSON.stringify(payload)})).result, parseEncryptedEmailAttachmentPayload(payload));
    assertEquals((await python({operation: "encrypted_email_attachment_parse", text: JSON.stringify({...payload, attachmentId: "  "})})).error, "invalid ciphertext");
  }
});

Deno.test("multi-recipient signature envelopes match Unicode sorting and JSON", async () => {
  const cases = [
    {message: "", recipients: [], manifest: [], salt: ""},
    {message: "quoted \" and slash / and 雪", recipients: ["  ebpdk1z  ", "ebpdk1a", "", "ebpdk1a"], manifest: [{attachmentId: "b", ciphertextSha256: "12"}, {attachmentId: "a", ciphertextSha256: "34"}], salt: "salt"},
    {message: "control" + String.fromCharCode(0, 1, 8, 9, 10, 12, 13, 31) + "\"/\\  ", recipients: ["b", "a"], manifest: [{attachmentId: "zero" + String.fromCharCode(0), ciphertextSha256: "x"}], salt: ""},
    {message: "NUL" + String.fromCharCode(0) + "🧪", recipients: ["\ue000", "𐀀", "x", " \t x \ufeff"], manifest: ["z", "ä", "A", "a", "é", "e\u0301", "!", "😀"].map((attachmentId, i) => ({attachmentId, ciphertextSha256: String(i)})), salt: "é"},
  ];
  for (const {message, recipients, manifest, salt} of cases) {
    const c = (await python({operation: "multi_envelope", message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(manifest), salt})).result;
    assertEquals(c, buildMultiRecipientBoundEnvelope(recipients, message, manifest, salt));
  }
});

Deno.test("v4 signatures bind recipients and attachment manifests across implementations", async () => {
  const sender = new Identity("dilithium", "kyber"), password = "secret", storage = sender.toStorageFormat(password);
  const message = "signed ☃", recipients = ["recipient-b", "recipient-a"], manifest = [{attachmentId: "é", ciphertextSha256: "34"}, {attachmentId: "a", ciphertextSha256: "12"}], salt = "salt";
  const ts = sender.signMessageForRecipients(message, recipients, manifest, salt);
  assertEquals((await python<boolean>({operation: "identity_verify_multi", storage, message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(manifest), salt, signature: ts})).result, true);
  const c = (await python({operation: "identity_sign_multi", storage, password, message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(manifest), salt})).result;
  assertEquals(Identity.VerifyMultiRecipientBoundSignature(sender.summary, recipients, message, c, manifest, salt), true);
  assertEquals(Identity.VerifyMultiRecipientBoundSignature(sender.summary, ["recipient-a"], message, c, manifest, salt), false);
  assertEquals((await python<boolean>({operation: "identity_verify_multi", storage, message, recipients: JSON.stringify(recipients), manifest: JSON.stringify([{...manifest[0], ciphertextSha256: "changed"}, manifest[1]]), salt, signature: ts})).result, false);
  const tied = [{attachmentId: "same", ciphertextSha256: "z"}, {attachmentId: "same", ciphertextSha256: "a"}];
  assertEquals(buildMultiRecipientBoundEnvelope(recipients, message, tied, salt), buildMultiRecipientBoundEnvelope(recipients, message, [...tied].reverse(), salt));
  assertEquals((await python({operation: "multi_envelope", message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(tied), salt})).result,
    buildMultiRecipientBoundEnvelope(recipients, message, [...tied].reverse(), salt));
});

Deno.test("complete signed multi-recipient messages exchange and reject tampering", async () => {
  const sender = new Identity("dilithium", "kyber"), alice = new Identity("dilithium", "kyber"), bob = new Identity("dilithium", "kyber"), outsider = new Identity("dilithium", "kyber");
  const password = "secret", message = "team ☃" + String.fromCharCode(0) + "update";
  const senderStorage = sender.toStorageFormat(password), aliceStorage = alice.toStorageFormat(password), bobStorage = bob.toStorageFormat(password), outsiderStorage = outsider.toStorageFormat(password);
  const manifest = [{attachmentId: "é", ciphertextSha256: "aa"}, {attachmentId: "a", ciphertextSha256: "bb"}];
  const suppliedKey = Uint8Array.from({length: 32}, (_, i) => 255 - i);
  const fromTs = sender.signAndEncryptForMany(message, [alice.summary, bob.summary, alice.summary], {attachmentManifest: manifest, contentKeyHex: hex(suppliedKey)});
  type Result = {message: string; verified: boolean; verifyStatus: string; contentKey: string; recipientFingerprints: string[]; attachmentManifest: typeof manifest};
  for (const recipient of [aliceStorage, bobStorage]) {
    const actual = (await python<Result>({operation: "multi_signed_decrypt", recipient, sender: senderStorage, password, payload: JSON.stringify(fromTs)})).result;
    assertEquals(actual.verified, true);
    assertEquals(actual.message, message);
    assertEquals(actual.recipientFingerprints, fromTs.recipientFingerprints);
    assertEquals(actual.attachmentManifest, fromTs.attachmentManifest);
  }
  const noEntry = (await python<Result>({operation: "multi_signed_decrypt", recipient: outsiderStorage, sender: senderStorage, password, payload: JSON.stringify(fromTs)})).result;
  assertEquals(noEntry.verified, false);
  assertEquals(noEntry.message, "");
  const wrongSender = (await python<Result>({operation: "multi_signed_decrypt", recipient: aliceStorage, sender: outsiderStorage, password, payload: JSON.stringify(fromTs)})).result;
  assertEquals(wrongSender.verified, false);
  type Packet = {recipients: typeof fromTs.recipients; contentNonce: string; ciphertext: string; contentKey: string; signature: string; recipientFingerprints: string[]; attachmentManifest: typeof manifest};
  const fromC = (await python<Packet>({operation: "multi_signed_encrypt", sender: senderStorage, password, recipient_storages: JSON.stringify([aliceStorage, bobStorage, aliceStorage]), message, manifest: JSON.stringify(manifest), content_key: hex(suppliedKey)})).result;
  assertEquals(fromC.contentKey, hex(suppliedKey));
  assertEquals(fromC.recipients.length, 2);
  for (const recipient of [alice, bob]) {
    const actual = recipient.decryptAndVerifyMulti(fromC, sender.summary);
    assertEquals(actual.verified, true);
    assertEquals(actual.message, message);
    assertEquals(actual.attachmentManifest, fromTs.attachmentManifest);
  }
  const key = Uint8Array.from(fromC.contentKey.match(/../g) ?? [], (part) => parseInt(part, 16));
  const forwarded = {...fromC, recipients: [...fromC.recipients, MultiRecipientCipher.wrapContentKeyForRecipient(key, outsider.summary)]};
  const forwardedResult = (await python<Result>({operation: "multi_signed_decrypt", recipient: outsiderStorage, sender: senderStorage, password, payload: JSON.stringify(forwarded)})).result;
  assertEquals(forwardedResult.verified, false);
  assertEquals(forwardedResult.verifyStatus, "invalid");
  const inner = JSON.parse(new TextDecoder().decode(MultiRecipientCipher.decryptWithContentKey(fromC.ciphertext, fromC.contentNonce, key)));
  const oldEncrypted = MultiRecipientCipher.encryptWithContentKey(new TextEncoder().encode(JSON.stringify({...inner, envelopeVersion: 3})), key);
  const oldPacket = {...fromC, ...oldEncrypted};
  assertEquals(alice.decryptAndVerifyMulti(oldPacket, sender.summary).verified, false);
  assertEquals((await python<Result>({operation: "multi_signed_decrypt", recipient: aliceStorage, sender: senderStorage, password, payload: JSON.stringify(oldPacket)})).result.verified, false);
  inner.attachmentManifest[0].ciphertextSha256 = "modified";
  const reencrypted = MultiRecipientCipher.encryptWithContentKey(new TextEncoder().encode(JSON.stringify(inner)), key);
  const changed = {...fromC, ...reencrypted};
  const rejected = (await python<Result>({operation: "multi_signed_decrypt", recipient: aliceStorage, sender: senderStorage, password, payload: JSON.stringify(changed)})).result;
  assertEquals(rejected.verified, false);
  assertEquals(rejected.verifyStatus, "invalid");
});

Deno.test("signed multi-recipient workflow handles an empty message and one recipient", async () => {
  const sender = new Identity("dilithium", "kyber"), recipient = new Identity("dilithium", "kyber"), password = "secret";
  const senderStorage = sender.toStorageFormat(password), recipientStorage = recipient.toStorageFormat(password);
  const ts = sender.signAndEncryptForMany("", [recipient.summary]);
  type Result = {message: string; verified: boolean; attachmentManifest: unknown[]};
  const c = (await python<Result>({operation: "multi_signed_decrypt", recipient: recipientStorage, sender: senderStorage, password, payload: JSON.stringify(ts)})).result;
  assertEquals(c.verified, true);
  assertEquals(c.message, "");
  assertEquals(c.attachmentManifest, []);
  type Packet = {recipients: typeof ts.recipients; contentNonce: string; ciphertext: string};
  const packet = (await python<Packet>({operation: "multi_signed_encrypt", sender: senderStorage, password, recipient_storages: JSON.stringify([recipientStorage]), message: "", manifest: "[]"})).result;
  assertEquals(recipient.decryptAndVerifyMulti(packet, sender.summary).verified, true);
});

Deno.test("multi-recipient canonical bytes cover all JSON control escapes", async () => {
  const message = Array.from({length: 32}, (_, i) => String.fromCharCode(i)).join("") + " literal\\u001F";
  const recipients = ["b", "a"], manifest = [{attachmentId: "a" + message, ciphertextSha256: "hash"}], salt = "";
  const actual = (await python({operation: "multi_envelope", message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(manifest), salt})).result;
  assertEquals(actual, buildMultiRecipientBoundEnvelope(recipients, message, manifest, salt));
});

Deno.test("multi-recipient manifest ordering is deterministic", async () => {
  const message = "message", recipients = ["b", "a"], salt = "";
  const manifest = ["ä", "z", "å", "a", "ö"].map((attachmentId) => ({attachmentId, ciphertextSha256: "hash"}));
  const canonicalManifest = [...manifest].sort((a, b) => a.attachmentId < b.attachmentId ? -1 : a.attachmentId > b.attachmentId ? 1 : a.ciphertextSha256 < b.ciphertextSha256 ? -1 : a.ciphertextSha256 > b.ciphertextSha256 ? 1 : 0);
  const canonical = canonicalJsonStringify({tag: "EBP-MULTIRECIPIENT-V4", message, recipientFingerprints: [...recipients].sort(), attachmentManifest: canonicalManifest});
  const actual = (await python({operation: "multi_envelope", message, recipients: JSON.stringify(recipients), manifest: JSON.stringify(manifest), salt})).result;
  assertEquals(actual, `ebp::messagehash::v4::${sha256Hex(canonical)}::`);
});

Deno.test("multi-recipient canonical JSON covers Unicode scalar ranges", async () => {
  let message = "";
  for (let cp = 0; cp <= 0xffff; cp++) if (cp < 0xd800 || cp > 0xdfff) message += String.fromCodePoint(cp);
  message += "𐀀🧪";
  const actual = (await python({operation: "multi_envelope", message, recipients: "[]", manifest: "[]", salt: ""})).result;
  assertEquals(actual, buildMultiRecipientBoundEnvelope([], message));
});

Deno.test("arbitrary supported HD paths match TypeScript derivation", async () => {
  const seed = Uint8Array.from({length: 64}, (_, i) => i);
  const paths = ["m/ebp'/dilithium'/0'/0/0", "m/ebp'/sphincs'/3'/1/5", " \ufeffm/ebp'/0/0001'/1'/02'\u00a0", "m/ebp'/1'/2147483647'/0/2147483647'", "m/ebp'/0001/000'/01/000"];
  for (const path of paths) {
    const expected = deriveNode(seed, path), parsed = parseHdPath(path);
    const actual = (await python<{key: string; chain: string; profile: string}>({operation: "hd_path", seed: hex(seed), path})).result;
    assertEquals(actual, {key: hex(expected.key), chain: hex(expected.chainCode), profile: parsed.profile});
  }
  for (const path of ["m", "m/ebp/0'/0'/0/0", "m/ebp'/dilithium/0'/0/0", "m/ebp'/2'/0'/0/0", "m/ebp'/0/0/0/0", "m/ebp'/0/0'/2/0", "m/ebp'/0/0'/0/2147483648", "m/ebp'/0/0'/0/0/1"]) {
    assertEquals((await python({operation: "hd_path", seed: hex(seed), path})).error, "invalid ciphertext");
  }
});

Deno.test("identity creation from arbitrary HD nodes matches TypeScript", async () => {
  const seed = Uint8Array.from({length: 64}, (_, i) => i);
  for (const path of ["m/ebp'/dilithium'/03'/1'/0005'", " m/ebp'/0'/4'/0/9 "]) {
    const node = deriveNode(seed, path), ts = Identity.fromHdNode(node, "dilithium", path);
    const c = (await python<{parsed: unknown; public: {fingerprint: string; hdProvenance: unknown}}>({operation: "identity_hd_node", seed: hex(seed), path})).result;
    assertEquals(c.parsed, parseHdPath(path));
    assertEquals(c.public.fingerprint, ts.toFingerprint());
    assertEquals(c.public.hdProvenance, ts.publicData.hdProvenance);
  }
});
