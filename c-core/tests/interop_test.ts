import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa";
import { ml_kem1024 } from "@noble/post-quantum/ml-kem";
import { slh_dsa_sha2_256s } from "@noble/post-quantum/slh-dsa";
import { deriveAccountNode, deriveIdentitySeeds } from "../../core/Hd.ts";
import { computeIdentityFingerprint } from "../../core/Fingerprint.ts";
import { bytesToBase64 } from "../../core/Base64.ts";
import { AES } from "../../core/AES.ts";
import { KyberEncryptionKey } from "../../core/Kyber.ts";
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
