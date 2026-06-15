import {
  decodeHierarchyCertificate,
  isHierarchyCertificateExpired,
  type SignedHierarchyCertificate,
} from '../../../core/HierarchyCertificate.ts';
import {stringToHex} from '../../../core/Hex.ts';

export type HierarchyTree = {
  fingerprint: string;
  root: string;
  ancestors: string[];
  descendants: string[];
  allFingerprints: string[];
  relationships: Array<{
    masterFingerprint: string;
    childFingerprint: string;
    timestamp: number;
    expiry: number;
    context: string;
    certificate: string;
    expired: boolean;
  }>;
};

export function buildHierarchyTreeFromCertificates(
  fingerprint: string,
  certs: SignedHierarchyCertificate[],
): HierarchyTree {
  const childToParent = new Map<string, SignedHierarchyCertificate>();
  const masterToChildren = new Map<string, SignedHierarchyCertificate[]>();
  for (const cert of certs) {
    childToParent.set(cert.childFingerprint, cert);
    const arr = masterToChildren.get(cert.masterFingerprint) ?? [];
    arr.push(cert);
    masterToChildren.set(cert.masterFingerprint, arr);
  }

  const ancestors: string[] = [];
  let root = fingerprint;
  while (true) {
    const parent = childToParent.get(root);
    if (!parent) {
      break;
    }
    ancestors.push(parent.masterFingerprint);
    root = parent.masterFingerprint;
  }

  const descendants: string[] = [];
  const relationships: HierarchyTree['relationships'] = [];
  const queue = [root];
  const seen = new Set<string>([root]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of masterToChildren.get(current) ?? []) {
      relationships.push({
        masterFingerprint: edge.masterFingerprint,
        childFingerprint: edge.childFingerprint,
        timestamp: edge.timestamp,
        expiry: edge.expiry,
        context: edge.context,
        certificate: stringToHex(JSON.stringify(edge)),
        expired: isHierarchyCertificateExpired({expiry: edge.expiry}),
      });
      descendants.push(edge.childFingerprint);
      if (!seen.has(edge.childFingerprint)) {
        seen.add(edge.childFingerprint);
        queue.push(edge.childFingerprint);
      }
    }
  }

  return {
    fingerprint,
    root,
    ancestors,
    descendants,
    allFingerprints: Array.from(
      new Set([fingerprint, root, ...ancestors, ...descendants]),
    ),
    relationships,
  };
}

export function decodeCertsFromStored(
  items: Array<{certificate: string}>,
): SignedHierarchyCertificate[] {
  const out: SignedHierarchyCertificate[] = [];
  for (const item of items) {
    const decoded = decodeHierarchyCertificate(item.certificate);
    if (decoded) {
      out.push(decoded);
    }
  }
  return out;
}
