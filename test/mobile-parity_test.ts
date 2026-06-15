import { assertEquals, assert } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "../core/Mnemonic.ts";
import { createHierarchyCertificate } from "../core/HierarchyCertificate.ts";
import { buildHierarchyTreeFromCertificates } from "../mobile/src/services/hierarchyTree.ts";
import { fingerprintFromPublicIdentity } from "../mobile/src/services/identityHelpers.ts";
import { computeExternalFingerprint } from "../core/Fingerprint.ts";

Deno.test("mobile parity: HD mnemonic derives deterministic fingerprint", () => {
  const mnemonic = generateMnemonic(256);
  assert(validateMnemonic(mnemonic));
  const seed = mnemonicToSeed(mnemonic, "");
  const a = Identity.fromAccount(seed, {
    profile: "dilithium",
    account: 0,
    change: "external",
    index: 0,
  });
  const b = Identity.fromAccount(seed, {
    profile: "dilithium",
    account: 0,
    change: "external",
    index: 0,
  });
  assertEquals(a.toFingerprint(), b.toFingerprint());
});

Deno.test("mobile parity: hierarchy tree builder merges edges", () => {
  const master = "fp_master_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const child = "fp_child_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const draft = createHierarchyCertificate(master, child);
  const signed = {
    ...draft,
    masterSignature: "aa",
    childSignature: "bb",
  };
  const tree = buildHierarchyTreeFromCertificates(master, [signed]);
  assertEquals(tree.root, master);
  assertEquals(tree.descendants.includes(child), true);
  assertEquals(tree.relationships.length, 1);
});

Deno.test("mobile parity: fingerprintFromPublicIdentity matches core", () => {
  const identity = new Identity("dilithium", "kyber");
  const summary = identity.summary;
  const publicIdentity = {
    fingerprint: summary.fingerprint,
    signingKeyType: summary.signingKeyType,
    encryptionKeyType: summary.encryptionKeyType,
    signingKey: summary.signingKey,
    encryptionKey: summary.encryptionKey,
    signingKeyDetails: summary.signingKeyDetails,
    encryptionKeyDetails: summary.encryptionKeyDetails,
    details: {},
  };
  const fromHelper = fingerprintFromPublicIdentity(publicIdentity);
  const fromCore = computeExternalFingerprint(publicIdentity);
  assert(fromCore);
  assertEquals(fromHelper, fromCore);
});
