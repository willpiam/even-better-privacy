import { hkdf } from "@noble/hashes/hkdf";
import { sha512 } from "@noble/hashes/sha2";
import { concatBytes } from "./Hex.ts";
import {
  childIndex,
  EBP_HD_VERSION,
  formatHdPath,
  type HdChange,
  type HdPath,
  type HdProfile,
  parseHdPath,
} from "./HdPath.ts";

const encoder = new TextEncoder();
const NODE_KEY_LENGTH = 32;
const NODE_CHAIN_CODE_LENGTH = 32;
export const DILITHIUM_HD_SEED_LENGTH = 32;
export const SPHINCS_HD_SEED_LENGTH = 96;
export const KYBER_HD_SEED_LENGTH = 64;

export type HdNode = {
  key: Uint8Array;
  chainCode: Uint8Array;
  depth: number;
  path: string;
};

export type HdIdentitySeeds = {
  profile: HdProfile;
  signingSeed: Uint8Array;
  encryptionSeed: Uint8Array;
};

export type HdProvenance = {
  version: typeof EBP_HD_VERSION;
  path: string;
  profile: HdProfile;
  account: number;
  change: HdChange;
  index: number;
};

function ser32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

function deriveMaterial(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Uint8Array {
  return hkdf(sha512, inputKeyMaterial, salt, encoder.encode(info), length);
}

export function masterNode(seed: Uint8Array): HdNode {
  const material = deriveMaterial(
    seed,
    encoder.encode(`${EBP_HD_VERSION}:master-salt`),
    `${EBP_HD_VERSION}:master-node`,
    NODE_KEY_LENGTH + NODE_CHAIN_CODE_LENGTH,
  );
  return {
    key: material.slice(0, NODE_KEY_LENGTH),
    chainCode: material.slice(NODE_KEY_LENGTH),
    depth: 0,
    path: "m",
  };
}

export function deriveChildNode(
  parent: HdNode,
  index: number,
  pathLabel: string,
): HdNode {
  const material = deriveMaterial(
    concatBytes(parent.key, ser32(index)),
    parent.chainCode,
    `${EBP_HD_VERSION}:child:${parent.depth + 1}`,
    NODE_KEY_LENGTH + NODE_CHAIN_CODE_LENGTH,
  );
  return {
    key: material.slice(0, NODE_KEY_LENGTH),
    chainCode: material.slice(NODE_KEY_LENGTH),
    depth: parent.depth + 1,
    path: parent.path === "m"
      ? `m/${pathLabel}`
      : `${parent.path}/${pathLabel}`,
  };
}

export function deriveNode(seed: Uint8Array, path: string | HdPath): HdNode {
  const parsed = typeof path === "string" ? parseHdPath(path) : path;
  let node = masterNode(seed);
  for (const segment of parsed.segments) {
    const label = `${segment.label}${segment.hardened ? "'" : ""}`;
    node = deriveChildNode(node, childIndex(segment), label);
  }
  return { ...node, path: parsed.path };
}

export function deriveIdentitySeeds(
  node: HdNode,
  profile: HdProfile,
): HdIdentitySeeds {
  const signingLength = profile === "dilithium"
    ? DILITHIUM_HD_SEED_LENGTH
    : SPHINCS_HD_SEED_LENGTH;
  return {
    profile,
    signingSeed: deriveMaterial(
      node.key,
      node.chainCode,
      `${EBP_HD_VERSION}:leaf:${profile}:sign-seed`,
      signingLength,
    ),
    encryptionSeed: deriveMaterial(
      node.key,
      node.chainCode,
      `${EBP_HD_VERSION}:leaf:kyber:kem-seed`,
      KYBER_HD_SEED_LENGTH,
    ),
  };
}

export function provenanceFromPath(path: string | HdPath): HdProvenance {
  const parsed = typeof path === "string" ? parseHdPath(path) : path;
  if (
    parsed.profile === undefined ||
    parsed.account === undefined ||
    parsed.change === undefined ||
    parsed.index === undefined
  ) {
    throw new Error("HD path is missing account metadata");
  }
  return {
    version: EBP_HD_VERSION,
    path: parsed.path,
    profile: parsed.profile,
    account: parsed.account,
    change: parsed.change,
    index: parsed.index,
  };
}

export function deriveAccountNode(input: {
  seed: Uint8Array;
  profile: HdProfile;
  account: number;
  change: HdChange;
  index: number;
}): { path: string; node: HdNode; provenance: HdProvenance } {
  const path = formatHdPath(input);
  return {
    path,
    node: deriveNode(input.seed, path),
    provenance: provenanceFromPath(path),
  };
}
