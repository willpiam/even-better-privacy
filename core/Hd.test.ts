import { assert, assertEquals } from "jsr:@std/assert";
import { Identity } from "./Identity.ts";
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  mnemonicToSeed,
  validateMnemonic,
} from "./Mnemonic.ts";
import { parseHdPath } from "./HdPath.ts";
import { toHex } from "./Hex.ts";
import { BIP39_ENGLISH_WORDLIST } from "./bip39-english.ts";
import testVectorsJson from "./tests/fixtures/ebp-hd/test-vectors.json" with {
  type: "json",
};

type VectorCase = {
  profile: "dilithium" | "sphincs";
  path: string;
  fingerprint: string;
};

type HdVector = {
  name: string;
  entropyHex: string;
  mnemonic: string;
  passphrase: string;
  seedHex: string;
  cases: VectorCase[];
};

type HdTestVectors = {
  version: string;
  mnemonicVersion: string;
  vectors: HdVector[];
};

const TEST_VECTORS = testVectorsJson as HdTestVectors;
const VECTOR = TEST_VECTORS.vectors[0];

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

Deno.test("EBP mnemonics encode entropy and derive canonical seeds", () => {
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

Deno.test("EBP-HD derives canonical identity fingerprints", () => {
  for (const vector of TEST_VECTORS.vectors) {
    const seed = mnemonicToSeed(vector.mnemonic, vector.passphrase);
    for (const testCase of vector.cases) {
      const parsed = parseHdPath(testCase.path);
      const identity = Identity.fromAccount(seed, {
        profile: parsed.profile!,
        account: parsed.account!,
        change: parsed.change!,
        index: parsed.index!,
      });
      assertEquals(identity.hdProvenance?.path, testCase.path);
      assertEquals(identity.toFingerprint(), testCase.fingerprint);
    }
  }
});

Deno.test("HD-derived identities behave like normal private identities", () => {
  const seed = mnemonicToSeed(VECTOR.mnemonic, VECTOR.passphrase);
  const sender = Identity.fromAccount(seed, {
    profile: "dilithium",
    account: 0,
    change: "external",
    index: 0,
  });
  const recipient = Identity.fromAccount(seed, {
    profile: "sphincs",
    account: 0,
    change: "external",
    index: 0,
  });

  const signature = sender.signMessage("hello hd");
  assert(Identity.VerifySignature(sender.summary, "hello hd", signature));

  const encrypted = sender.signAndEncryptMessage("secret hd", recipient);
  const decrypted = recipient.decryptAndVerify(encrypted, sender.summary);
  assertEquals(decrypted.verified, true);
  assertEquals(decrypted.message, "secret hd");
});

Deno.test("HD provenance survives identity storage round trip and remains optional", () => {
  const seed = mnemonicToSeed(VECTOR.mnemonic, VECTOR.passphrase);
  const original = Identity.fromAccount(seed, {
    profile: "dilithium",
    account: 0,
    change: "external",
    index: 0,
  });
  const loaded = Identity.fromStorageFormat(
    original.toStorageFormat("correct horse battery staple"),
    "correct horse battery staple",
  );

  assertEquals(loaded.hdProvenance, original.hdProvenance);
  const nonHd = new Identity("dilithium", "kyber");
  assertEquals(nonHd.hdProvenance, undefined);
});
