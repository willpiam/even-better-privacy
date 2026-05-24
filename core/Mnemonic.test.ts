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

const encoder = new TextEncoder();

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

Deno.test("mnemonic entropy round-trips for 128 and 256 bit strengths", () => {
  for (
    const entropyHex of [
      "00000000000000000000000000000000",
      "0000000000000000000000000000000000000000000000000000000000000001",
    ]
  ) {
    const entropy = hexToBytes(entropyHex);
    const mnemonic = entropyToMnemonic(entropy);
    assert(
      mnemonic.split(" ").every((word) =>
        BIP39_ENGLISH_WORDLIST.includes(word)
      ),
    );
    assert(validateMnemonic(mnemonic));
    assertEquals(toHex(mnemonicToEntropy(mnemonic)), entropyHex);
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
