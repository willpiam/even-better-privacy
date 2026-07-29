import {decodeFingerprintBech32, toHex} from '../ebpCore';
import type {IdentityPublicData} from '../ebpCore';
import type {StoredContact} from './contacts';
import {
  condenseFingerprint,
  resolveContactLabels,
  storedContactToLike,
} from './contactDisplay';
import type {HierarchyTree} from './hierarchyTree';

export type HierarchyDiagramNode = {
  fingerprint: string;
  label: string;
  details: Record<string, string>;
  color: string;
  isSelf: boolean;
  isFocus: boolean;
};

export type HierarchyDiagramRelationship = {
  masterFingerprint: string;
  childFingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
  certificate: string;
  expired: boolean;
};

export type HierarchyDiagram = {
  focusFingerprint: string;
  nodes: HierarchyDiagramNode[];
  relationships: HierarchyDiagramRelationship[];
  roots: string[];
};

export function fingerprintColor(fp: string): string {
  try {
    const decoded = decodeFingerprintBech32(fp);
    const bytes = decoded.bytes;
    const last3 = bytes.slice(bytes.length - 3);
    return `#${toHex(last3)}`;
  } catch {
    return '#58a6ff';
  }
}

function detailMap(
  details: Record<string, [string, string]> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!details) {
    return out;
  }
  for (const [key, val] of Object.entries(details)) {
    out[key] = Array.isArray(val) ? val[0] : String(val);
  }
  return out;
}

export function enrichHierarchyDiagram(
  tree: HierarchyTree,
  opts: {
    selfFingerprint: string | null;
    selfName?: string | null;
    selfPublic?: IdentityPublicData | null;
    contacts: StoredContact[];
  },
): HierarchyDiagram {
  const contactByFp = new Map<string, StoredContact>();
  for (const item of opts.contacts) {
    if (item.contact.fingerprint) {
      contactByFp.set(item.contact.fingerprint, item);
    }
  }

  const childSet = new Set(
    tree.relationships.map(rel => rel.childFingerprint),
  );
  const roots: string[] = [];
  for (const fp of tree.allFingerprints) {
    if (!childSet.has(fp)) {
      roots.push(fp);
    }
  }

  const selfDetails = detailMap(opts.selfPublic?.details);
  const nodes: HierarchyDiagramNode[] = tree.allFingerprints.map(fp => {
    const isSelf = Boolean(opts.selfFingerprint && fp === opts.selfFingerprint);
    const isFocus = fp === tree.fingerprint;
    let label = condenseFingerprint(fp);
    let details: Record<string, string> = {};

    if (isSelf) {
      details = {...selfDetails};
      if (selfDetails.name?.trim()) {
        label = selfDetails.name.trim();
      } else if (opts.selfName?.trim()) {
        label = opts.selfName.trim();
      }
    } else {
      const contact = contactByFp.get(fp);
      if (contact) {
        const labels = resolveContactLabels(storedContactToLike(contact));
        label = labels.primary;
        details = detailMap(contact.contact.details);
      }
    }

    return {
      fingerprint: fp,
      label,
      details,
      color: fingerprintColor(fp),
      isSelf,
      isFocus,
    };
  });

  return {
    focusFingerprint: tree.fingerprint,
    nodes,
    relationships: tree.relationships.map(rel => ({
      masterFingerprint: rel.masterFingerprint,
      childFingerprint: rel.childFingerprint,
      timestamp: rel.timestamp,
      expiry: rel.expiry,
      context: rel.context,
      certificate: rel.certificate,
      expired: rel.expired,
    })),
    roots,
  };
}
