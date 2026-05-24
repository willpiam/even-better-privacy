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

const VECTOR = {
  entropyHex:
    "0000000000000000000000000000000000000000000000000000000000000001",
  mnemonic:
    "ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp000 ebp1ec",
  passphrase: "test-passphrase",
  seedHex:
    "53ccb9d74511e46b644f47f464a2ef8fa9dd9d4d526dd226401cebc6f92aeefd54422127fc1e0e7cfe428b3b281aa2ccf056c84e0f8490ad759ebbfe4700a99e",
  cases: [
    {
      profile: "dilithium" as const,
      path: "m/ebp'/dilithium'/0'/0/0",
      fingerprint:
        "ebpdk1ngdumuv4gle2r0vcrmu23fny0g2p3j8xg34aysllwahqwrzwgyyqvetht6",
    },
    {
      profile: "sphincs" as const,
      path: "m/ebp'/sphincs'/0'/0/0",
      fingerprint:
        "ebpsk1tj69utzntz836dz3e0y7v22tfftna5y59ptkeypg76gmjqakjwjs0lt880",
    },
  ],
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
}

Deno.test("EBP mnemonic encodes entropy with checksum and derives test-vector seed", () => {
  const entropy = hexToBytes(VECTOR.entropyHex);
  const mnemonic = entropyToMnemonic(entropy);
  assertEquals(mnemonic, VECTOR.mnemonic);
  assert(validateMnemonic(mnemonic));
  assertEquals(toHex(mnemonicToEntropy(mnemonic)), VECTOR.entropyHex);
  assertEquals(
    toHex(mnemonicToSeed(mnemonic, VECTOR.passphrase)),
    VECTOR.seedHex,
  );
});

Deno.test("EBP-HD derives deterministic identity fingerprints for both signing profiles", () => {
  const seed = mnemonicToSeed(VECTOR.mnemonic, VECTOR.passphrase);
  for (const testCase of VECTOR.cases) {
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
