import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256, sha512 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";

const encoder = new TextEncoder();

export const EBP_MNEMONIC_VERSION = "ebp-mnemonic-v1";
export const EBP_MNEMONIC_WORD_COUNT = 2048;
export const EBP_MNEMONIC_PBKDF2_ITERATIONS = 2048;
export const EBP_MNEMONIC_SEED_LENGTH = 64;

// EBP v1 intentionally uses a project-owned fixed 2048-entry list instead of
// pretending Bitcoin's English list is protocol-bound to EBP. The index space
// and checksum mechanics match BIP39's 11-bit grouping.
export const EBP_MNEMONIC_WORDLIST = Object.freeze(
  Array.from(
    { length: EBP_MNEMONIC_WORD_COUNT },
    (_, i) => `ebp${i.toString(16).padStart(3, "0")}`,
  ),
);

const WORD_TO_INDEX = new Map(
  EBP_MNEMONIC_WORDLIST.map((word, index) => [word, index]),
);

function bytesToBits(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(2).padStart(8, "0")).join(
    "",
  );
}

function bitsToBytes(bits: string): Uint8Array {
  if (bits.length % 8 !== 0) {
    throw new Error("bit string length must be a multiple of 8");
  }
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

function normalizeMnemonic(mnemonic: string): string[] {
  return mnemonic.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function assertValidStrength(strength: number): void {
  if (
    !Number.isInteger(strength) || strength < 128 || strength > 256 ||
    strength % 32 !== 0
  ) {
    throw new Error(
      "mnemonic strength must be 128, 160, 192, 224, or 256 bits",
    );
  }
}

export function entropyToMnemonic(entropy: Uint8Array): string {
  const strength = entropy.length * 8;
  assertValidStrength(strength);
  const checksumLength = strength / 32;
  const entropyBits = bytesToBits(entropy);
  const checksumBits = bytesToBits(sha256(entropy)).slice(0, checksumLength);
  const bits = entropyBits + checksumBits;
  const words: string[] = [];
  for (let i = 0; i < bits.length; i += 11) {
    words.push(
      EBP_MNEMONIC_WORDLIST[Number.parseInt(bits.slice(i, i + 11), 2)],
    );
  }
  return words.join(" ");
}

export function mnemonicToEntropy(mnemonic: string): Uint8Array {
  const words = normalizeMnemonic(mnemonic);
  if (![12, 15, 18, 21, 24].includes(words.length)) {
    throw new Error("mnemonic must contain 12, 15, 18, 21, or 24 words");
  }
  let bits = "";
  for (const word of words) {
    const index = WORD_TO_INDEX.get(word);
    if (index === undefined) throw new Error(`unknown mnemonic word: ${word}`);
    bits += index.toString(2).padStart(11, "0");
  }
  const checksumLength = bits.length / 33;
  const entropyLength = bits.length - checksumLength;
  const entropyBits = bits.slice(0, entropyLength);
  const checksumBits = bits.slice(entropyLength);
  const entropy = bitsToBytes(entropyBits);
  const expectedChecksum = bytesToBits(sha256(entropy)).slice(
    0,
    checksumLength,
  );
  if (checksumBits !== expectedChecksum) {
    throw new Error("mnemonic checksum mismatch");
  }
  return entropy;
}

export function generateMnemonic(strength = 256): string {
  assertValidStrength(strength);
  return entropyToMnemonic(randomBytes(strength / 8));
}

export function validateMnemonic(mnemonic: string): boolean {
  try {
    mnemonicToEntropy(mnemonic);
    return true;
  } catch {
    return false;
  }
}

export function mnemonicToSeed(mnemonic: string, passphrase = ""): Uint8Array {
  mnemonicToEntropy(mnemonic);
  const password = encoder.encode(
    mnemonic.trim().toLowerCase().replace(/\s+/g, " "),
  );
  const salt = encoder.encode(
    `${EBP_MNEMONIC_VERSION}:${passphrase.normalize("NFKD")}`,
  );
  return pbkdf2(sha512, password, salt, {
    c: EBP_MNEMONIC_PBKDF2_ITERATIONS,
    dkLen: EBP_MNEMONIC_SEED_LENGTH,
  });
}
