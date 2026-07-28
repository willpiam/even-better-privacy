import { assertEquals, assert } from "jsr:@std/assert";
import { Identity } from "../core/Identity.ts";
import {
  generateMnemonic,
  mnemonicToSeed,
  validateMnemonic,
} from "../core/Mnemonic.ts";
import { createHierarchyCertificate } from "../core/HierarchyCertificate.ts";
import { buildHierarchyTreeFromCertificates } from "../mobile/src/services/hierarchyTree.ts";
import {
  filterPendingForIdentity,
  mergePendingProposals,
  type PendingHierarchyProposal,
} from "../mobile/src/services/hierarchyPending.ts";
import { fingerprintFromPublicIdentity } from "../mobile/src/services/identityHelpers.ts";
import { computeExternalFingerprint } from "../core/Fingerprint.ts";

function sampleProposal(
  overrides: Partial<PendingHierarchyProposal> &
    Pick<
      PendingHierarchyProposal,
      "id" | "masterFingerprint" | "childFingerprint" | "proposerFingerprint"
    >,
): PendingHierarchyProposal {
  return {
    certificate: "aa",
    context: "",
    expiry: 0,
    createdAt: overrides.createdAt ?? overrides.id,
    source: overrides.source,
    ...overrides,
  };
}

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

Deno.test("mobile parity: pending merge prefers server id for same pair", () => {
  const master = "fp_master";
  const child = "fp_child";
  const local = [
    sampleProposal({
      id: 1,
      masterFingerprint: master,
      childFingerprint: child,
      proposerFingerprint: master,
      source: "local",
      createdAt: 100,
    }),
  ];
  const server = [
    sampleProposal({
      id: 42,
      masterFingerprint: master,
      childFingerprint: child,
      proposerFingerprint: master,
      source: "server",
      createdAt: 200,
    }),
  ];
  const merged = mergePendingProposals(local, server);
  assertEquals(merged.length, 1);
  assertEquals(merged[0].id, 42);
  assertEquals(merged[0].source, "server");
});

Deno.test("mobile parity: pending filter hides proposer-owned rows", () => {
  const master = "fp_master";
  const child = "fp_child";
  const items = [
    sampleProposal({
      id: 1,
      masterFingerprint: master,
      childFingerprint: child,
      proposerFingerprint: master,
      source: "server",
    }),
    sampleProposal({
      id: 2,
      masterFingerprint: "fp_a",
      childFingerprint: "fp_b",
      proposerFingerprint: "fp_a",
      source: "server",
    }),
  ];
  const forChild = filterPendingForIdentity(items, child);
  assertEquals(forChild.length, 1);
  assertEquals(forChild[0].id, 1);
  const forMaster = filterPendingForIdentity(items, master);
  assertEquals(forMaster.length, 0);
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
