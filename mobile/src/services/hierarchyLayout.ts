export type LayoutNode = {
  fingerprint: string;
};

export type LayoutRelationship = {
  masterFingerprint: string;
  childFingerprint: string;
};

export type TreeLayoutResult = {
  positions: Map<string, {x: number; y: number}>;
  svgWidth: number;
  svgHeight: number;
  nodeRadius: number;
};

export const HIERARCHY_LAYOUT = {
  nodeRadius: 26,
  levelHeight: 160,
  nodeSpacingX: 180,
  paddingX: 100,
  paddingY: 80,
  arrowGap: 4,
} as const;

/** Leveled BFS layout matching gui/js/hierarchy.js `_layoutTree`. */
export function layoutHierarchyTree(
  nodes: LayoutNode[],
  relationships: LayoutRelationship[],
  roots: string[],
): TreeLayoutResult {
  const childrenOf = new Map<string, string[]>();
  const allFingerprints = new Set(nodes.map(n => n.fingerprint));
  for (const fp of allFingerprints) {
    childrenOf.set(fp, []);
  }
  for (const rel of relationships) {
    const arr = childrenOf.get(rel.masterFingerprint) || [];
    if (!arr.includes(rel.childFingerprint)) {
      arr.push(rel.childFingerprint);
    }
    childrenOf.set(rel.masterFingerprint, arr);
  }

  const levels = new Map<string, number>();
  const visited = new Set<string>();
  const queue: Array<{fp: string; level: number}> = [];

  for (const r of roots) {
    if (allFingerprints.has(r)) {
      queue.push({fp: r, level: 0});
      visited.add(r);
      levels.set(r, 0);
    }
  }

  const runBfs = () => {
    while (queue.length > 0) {
      const {fp, level} = queue.shift()!;
      const children = childrenOf.get(fp) || [];
      for (const child of children) {
        if (!levels.has(child)) {
          levels.set(child, level + 1);
          visited.add(child);
          queue.push({fp: child, level: level + 1});
        }
      }
    }
  };

  runBfs();

  // Orphan / disconnected nodes become additional roots after the primary BFS.
  for (const fp of allFingerprints) {
    if (!visited.has(fp)) {
      queue.push({fp, level: 0});
      visited.add(fp);
      levels.set(fp, 0);
      runBfs();
    }
  }

  const byLevel = new Map<number, string[]>();
  for (const [fp, lv] of levels) {
    const arr = byLevel.get(lv) || [];
    arr.push(fp);
    byLevel.set(lv, arr);
  }

  const maxLevel = Math.max(...Array.from(byLevel.keys()), 0);
  const {
    nodeRadius,
    levelHeight,
    nodeSpacingX,
    paddingX,
    paddingY,
  } = HIERARCHY_LAYOUT;

  let maxRowWidth = 0;
  for (let lv = 0; lv <= maxLevel; lv++) {
    const row = byLevel.get(lv) || [];
    if (row.length > maxRowWidth) {
      maxRowWidth = row.length;
    }
  }
  const totalWidth = Math.max(maxRowWidth * nodeSpacingX, 200);

  const positions = new Map<string, {x: number; y: number}>();
  for (let lv = 0; lv <= maxLevel; lv++) {
    const row = byLevel.get(lv) || [];
    const rowWidth = row.length * nodeSpacingX;
    const offsetX = (totalWidth - rowWidth) / 2 + nodeSpacingX / 2 + paddingX;
    const y = paddingY + lv * levelHeight;
    for (let i = 0; i < row.length; i++) {
      positions.set(row[i], {x: offsetX + i * nodeSpacingX, y});
    }
  }

  const svgWidth = totalWidth + paddingX * 2;
  const svgHeight = paddingY * 2 + maxLevel * levelHeight + nodeRadius;

  return {positions, svgWidth, svgHeight, nodeRadius};
}

export function hierarchyEdgePathD(
  from: {x: number; y: number},
  to: {x: number; y: number},
  nodeRadius: number = HIERARCHY_LAYOUT.nodeRadius,
  arrowGap: number = HIERARCHY_LAYOUT.arrowGap,
): string {
  const startY = from.y + nodeRadius;
  const endY = to.y - nodeRadius - arrowGap;
  const midY = (startY + endY) / 2;
  return `M ${from.x} ${startY} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${endY}`;
}
