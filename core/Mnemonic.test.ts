import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "jsr:@std/assert";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";
import { toHex } from "./Hex.ts";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from "./Mnemonic.ts";
import {
  assertBip39EnglishWordlistIntegrity,
  BIP39_ENGLISH_SHA256,
  BIP39_ENGLISH_WORDLIST,
} from "./bip39-english.ts";
import testVectorsJson from "./tests/fixtures/ebp-hd/test-vectors.json" with {
  type: "json",
};

const encoder = new TextEncoder();

type MnemonicVector = {
  entropyHex: string;
  mnemonic: string;
  passphrase: string;
  seedHex: string;
};

const TEST_VECTORS = testVectorsJson as {
  version: string;
  mnemonicVersion: string;
  vectors: MnemonicVector[];
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

Deno.test("BIP39 English wordlist has canonical integrity", () => {
  assertEquals(BIP39_ENGLISH_WORDLIST.length, 2048);
  assertEquals(BIP39_ENGLISH_WORDLIST[0], "abandon");
  assertEquals(BIP39_ENGLISH_WORDLIST[2047], "zoo");
  const text = `${BIP39_ENGLISH_WORDLIST.join("\n")}\n`;
  assertEquals(bytesToHex(sha256(encoder.encode(text))), BIP39_ENGLISH_SHA256);
  assertBip39EnglishWordlistIntegrity();
});

Deno.test("mnemonic vectors round-trip entropy and derive canonical seeds", () => {
  assertEquals(TEST_VECTORS.version, "ebp-hd-v1");
  assertEquals(TEST_VECTORS.mnemonicVersion, "ebp-mnemonic-v2");
  for (const vector of TEST_VECTORS.vectors) {
    const entropy = hexToBytes(vector.entropyHex);
    const mnemonic = entropyToMnemonic(entropy);
    assertEquals(mnemonic, vector.mnemonic);
    assert(
      mnemonic.split(" ").every((word) =>
        BIP39_ENGLISH_WORDLIST.includes(word)
      ),
    );
    assert(validateMnemonic(mnemonic));
    assertEquals(toHex(mnemonicToEntropy(mnemonic)), vector.entropyHex);
    assertEquals(
      toHex(mnemonicToSeed(mnemonic, vector.passphrase)),
      vector.seedHex,
    );
  }
});

Deno.test("mnemonic rejects old ebp index tokens and invalid phrases", () => {
  assertThrows(
    () => mnemonicToEntropy("ebp000 ".repeat(12).trim()),
    Error,
    "unknown mnemonic word",
  );
  assertThrows(
    () => mnemonicToEntropy("abandon ".repeat(11).trim()),
    Error,
    "mnemonic must contain",
  );
  assertThrows(
    () => mnemonicToEntropy("abandon ".repeat(11) + "foobar"),
    Error,
    "unknown mnemonic word",
  );
  assertThrows(
    () => mnemonicToEntropy("abandon ".repeat(12).trim()),
    Error,
    "mnemonic checksum mismatch",
  );
});

Deno.test("mnemonic seed normalizes passphrase using NFKD", () => {
  const mnemonic =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const composed = mnemonicToSeed(mnemonic, "\u00e9");
  const decomposed = mnemonicToSeed(mnemonic, "e\u0301");
  const different = mnemonicToSeed(mnemonic, "e");
  assertEquals(toHex(composed), toHex(decomposed));
  assertNotEquals(toHex(composed), toHex(different));
});
