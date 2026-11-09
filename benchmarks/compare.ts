/** Compare the current TypeScript and C APIs in one process. See README.md. */
import { sha256 } from "@noble/hashes/sha2";
import { AES } from "../core/AES.ts";
import { Identity } from "../core/Identity.ts";
import { base64ToBytes, bytesToBase64 } from "../core/Base64.ts";
import { hexToBytes, toHex } from "../core/Hex.ts";

const lib = Deno.dlopen("./c-core/libebp_core.so", {
  ebp_sha256: { parameters: ["buffer", "usize", "buffer"], result: "i32" },
  ebp_derive_storage_key: { parameters: ["buffer", "usize", "buffer", "buffer"], result: "i32" },
  ebp_identity_from_hd_seed: { parameters: ["buffer", "usize", "i32", "u32", "i32", "u32", "buffer"], result: "i32" },
  ebp_identity_sign: { parameters: ["pointer", "i32", "buffer", "usize", "buffer", "usize", "buffer", "buffer"], result: "i32" },
  ebp_identity_verify: { parameters: ["pointer", "i32", "buffer", "usize", "buffer", "usize", "buffer", "usize"], result: "i32" },
  ebp_identity_sign_encrypt: { parameters: ["pointer", "pointer", "buffer", "usize", "buffer", "buffer"], result: "i32" },
  ebp_identity_decrypt_verify: { parameters: ["pointer", "pointer", "buffer", "usize", "buffer", "buffer", "buffer"], result: "i32" },
  ebp_identity_free: { parameters: ["pointer"], result: "void" },
  ebp_free: { parameters: ["pointer"], result: "void" },
  ebp_secure_free: { parameters: ["pointer", "usize"], result: "void" },
} as const);
const c = lib.symbols;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const message = "A message with 1 KiB of text. ".padEnd(1024, "x");
const messageBytes = encoder.encode(message);
const seed = Uint8Array.from({ length: 64 }, (_, i) => i);
const password = "benchmark password";
const salt = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
const empty = new Uint8Array();
const check = (ok: unknown, label: string) => { if (!ok) throw new Error(label); };
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

function cIdentity(index: number): Deno.PointerValue {
  const slot = new BigUint64Array(1);
  check(c.ebp_identity_from_hd_seed(seed, BigInt(seed.length), 0, 0, 0, index, slot) === 1, "C identity setup failed");
  return Deno.UnsafePointer.create(slot[0]!);
}
// Read and release the buffer returned by a C call. Copy and free are timed.
function resultBytes(call: (out: BigUint64Array, size: BigUint64Array) => number, secret = false): Uint8Array {
  const slot = new BigUint64Array(1), length = new BigUint64Array(1);
  check(call(slot, length) === 1, "C operation failed");
  const ptr = Deno.UnsafePointer.create(slot[0]!);
  check(ptr !== null, "C returned a null buffer");
  const size = Number(length[0]);
  try { return new Uint8Array(new Deno.UnsafePointerView(ptr!).getArrayBuffer(size)).slice(); }
  finally { if (secret) c.ebp_secure_free(ptr, length[0]!); else c.ebp_free(ptr); }
}
const sender = Identity.fromAccount(seed, {profile: "dilithium", account: 0, change: "external", index: 0});
const recipient = Identity.fromAccount(seed, {profile: "dilithium", account: 0, change: "external", index: 1});
const publicSender = sender.summary;
const cSender = cIdentity(0), cRecipient = cIdentity(1);
const cHash = () => { const out = new Uint8Array(32); check(c.ebp_sha256(messageBytes, BigInt(messageBytes.length), out) === 1, "C hash failed"); return out; };
const cKdf = () => { const input = encoder.encode(password), out = new Uint8Array(32); check(c.ebp_derive_storage_key(input, BigInt(input.length), salt, out) === 1, "C KDF failed"); return out; };
const cSign = () => { const input = encoder.encode(message); return bytesToBase64(resultBytes((out, len) => c.ebp_identity_sign(cSender, 1, input, BigInt(input.length), empty, 0n, out, len))); };
const cVerify = (signature: string) => { const input = encoder.encode(message), bytes = base64ToBytes(signature); return c.ebp_identity_verify(cSender, 1, input, BigInt(input.length), empty, 0n, bytes, BigInt(bytes.length)) === 1; };
const cEncrypt = () => { const input = encoder.encode(message); return toHex(resultBytes((out, len) => c.ebp_identity_sign_encrypt(cSender, cRecipient, input, BigInt(input.length), out, len))); };
const cDecrypt = (ciphertext: string) => {
  const input = hexToBytes(ciphertext), verified = new Int32Array(1);
  const bytes = resultBytes((out, len) => c.ebp_identity_decrypt_verify(cRecipient, cSender, input, BigInt(input.length), out, len, verified), true);
  return { message: decoder.decode(bytes), verified: verified[0] === 1 };
};

try {
  const tsSignature = sender.signMessage(message), cSignature = cSign();
  const tsCipher = sender.signAndEncryptMessage(message, recipient), cCipher = cEncrypt();
  check(equal(sha256(messageBytes), cHash()), "hash mismatch");
  check(equal(AES.deriveKeyForStorage(password, salt, 4), cKdf()), "KDF mismatch");
  check(cVerify(tsSignature) && Identity.VerifySignature(publicSender, message, cSignature), "signature interoperability failed");
  const fromC = recipient.decryptAndVerify(cCipher, publicSender), fromTs = cDecrypt(tsCipher);
  check(fromC.verified && fromC.message === message && fromTs.verified && fromTs.message === message, "message interoperability failed");

  type Job = { name: string; typescript: () => unknown; c: () => unknown; maxIterations: number };
  const jobs: Job[] = [
    {name: "SHA-256 (1 KiB)", typescript: () => sha256(messageBytes), c: cHash, maxIterations: 10000},
    {name: "Argon2id storage key", typescript: () => AES.deriveKeyForStorage(password, salt, 4), c: cKdf, maxIterations: 1},
    {name: "Sign message (ML-DSA-87)", typescript: () => sender.signMessage(message), c: cSign, maxIterations: 100},
    {name: "Verify message (ML-DSA-87)", typescript: () => Identity.VerifySignature(publicSender, message, tsSignature), c: () => cVerify(tsSignature), maxIterations: 200},
    {name: "Sign + encrypt (1 recipient)", typescript: () => sender.signAndEncryptMessage(message, recipient), c: cEncrypt, maxIterations: 100},
    {name: "Decrypt + verify (1 recipient)", typescript: () => recipient.decryptAndVerify(tsCipher, publicSender), c: () => cDecrypt(tsCipher), maxIterations: 100},
  ];
  const rounds = Number(Deno.args[1] ?? 10);
  const targetMs = Number(Deno.args[2] ?? 150);
  if (!Number.isInteger(rounds) || rounds < 3 || !Number.isFinite(targetMs) || targetMs < 1) throw new Error("Usage: compare.ts OUTPUT.json [rounds >= 3] [target milliseconds >= 1]");
  const time = (fn: () => unknown, n: number) => { const start = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - start) / n; };
  const data = [];
  for (const job of jobs) {
    // Warm both implementations before selecting a common batch size.
    for (let i = 0; i < 3; i++) { job.typescript(); job.c(); }
    const tsPilot = time(job.typescript, 1), cPilot = time(job.c, 1);
    // Independently size batches so both fast and slow calls have useful timing resolution.
    const iterations = {
      typescript: Math.min(job.maxIterations, Math.max(1, Math.ceil(targetMs / tsPilot))),
      c: Math.min(job.maxIterations, Math.max(1, Math.ceil(targetMs / cPilot))),
    };
    time(job.typescript, iterations.typescript);
    time(job.c, iterations.c);
    const samples: {typescript_ms: number; c_ms: number}[] = [];
    for (let round = 0; round < rounds; round++) {
      let typescript_ms: number, c_ms: number;
      if (round % 2 === 0) { typescript_ms = time(job.typescript, iterations.typescript); c_ms = time(job.c, iterations.c); }
      else { c_ms = time(job.c, iterations.c); typescript_ms = time(job.typescript, iterations.typescript); }
      samples.push({typescript_ms, c_ms});
    }
    data.push({name: job.name, iterations_per_round: iterations, samples});
    console.error(`${job.name}: ${rounds} rounds, ${iterations.typescript} TypeScript and ${iterations.c} C calls per round`);
  }
  const report = { generated_at: new Date().toISOString(), deno: Deno.version, platform: Deno.build, rounds, target_ms: targetMs,
    message_bytes: messageBytes.length, notes: "Deno FFI; current-format APIs; setup and process startup excluded", results: data };
  await Deno.writeTextFile(Deno.args[0] ?? "benchmarks/results/latest.json", JSON.stringify(report, null, 2) + "\n");
} finally {
  c.ebp_identity_free(cSender); c.ebp_identity_free(cRecipient); lib.close();
}
