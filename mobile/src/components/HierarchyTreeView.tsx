import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  LayoutChangeEvent,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  Marker,
  Path,
  Text as SvgText,
} from 'react-native-svg';
import type {HierarchyDiagram} from '../services/hierarchyDiagram';
import {
  hierarchyEdgePathD,
  layoutHierarchyTree,
} from '../services/hierarchyLayout';
import type {
  HierarchyDiagramDetail,
  HierarchyEdgeDetail,
  HierarchyNodeDetail,
} from './HierarchyDiagramDetailModal';
import {colors, radius, spacing, typography} from '../theme/tokens';

const VIEW_HEIGHT = 320;
const WARNING = '#d29922';
const EDGE_MUTED = '#666666';
const ZOOM_IN = 0.9;
const ZOOM_OUT = 1.1;

type ViewBox = {x: number; y: number; w: number; h: number};

type Props = {
  diagram: HierarchyDiagram;
  onSelectDetail: (detail: HierarchyDiagramDetail) => void;
};

function truncateLabel(label: string, max = 14): string {
  if (label.length <= max) {
    return label;
  }
  return `${label.substring(0, max - 1)}…`;
}

function shortFp(fp: string): string {
  return `${fp.substring(0, 16)}…`;
}

export default function HierarchyTreeView({
  diagram,
  onSelectDetail,
}: Props): JSX.Element {
  const [viewport, setViewport] = useState({width: 1, height: VIEW_HEIGHT});
  const [viewBox, setViewBox] = useState<ViewBox>({x: 0, y: 0, w: 1, h: 1});
  const viewBoxRef = useRef(viewBox);
  viewBoxRef.current = viewBox;
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const panStartRef = useRef<{
    x: number;
    y: number;
    vbX: number;
    vbY: number;
  } | null>(null);
  const movedRef = useRef(false);

  const layout = useMemo(
    () =>
      layoutHierarchyTree(diagram.nodes, diagram.relationships, diagram.roots),
    [diagram],
  );

  const nodeMap = useMemo(() => {
    const map = new Map(diagram.nodes.map(n => [n.fingerprint, n]));
    return map;
  }, [diagram.nodes]);

  const fitAll = useCallback(() => {
    const {positions, nodeRadius, svgWidth, svgHeight} = layout;
    if (positions.size === 0) {
      setViewBox({x: 0, y: 0, w: Math.max(svgWidth, 1), h: Math.max(svgHeight, 1)});
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of positions.values()) {
      minX = Math.min(minX, p.x - nodeRadius - 12);
      maxX = Math.max(maxX, p.x + nodeRadius + 12);
      minY = Math.min(minY, p.y - nodeRadius - 12);
      maxY = Math.max(maxY, p.y + nodeRadius + 36);
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      setViewBox({x: 0, y: 0, w: svgWidth, h: svgHeight});
      return;
    }
    const pad = 32;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;
    let contentW = Math.max(maxX - minX, 1);
    let contentH = Math.max(maxY - minY, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const vp = viewportRef.current;
    const viewportAspect = Math.max(vp.width, 1) / Math.max(vp.height, 1);
    const contentAspect = contentW / contentH;
    if (contentAspect > viewportAspect) {
      contentH = contentW / viewportAspect;
    } else {
      contentW = contentH * viewportAspect;
    }
    setViewBox({
      x: centerX - contentW / 2,
      y: centerY - contentH / 2,
      w: contentW,
      h: contentH,
    });
  }, [layout]);

  useEffect(() => {
    fitAll();
  }, [fitAll, diagram.focusFingerprint]);

  const zoomBy = useCallback((factor: number) => {
    setViewBox(vb => {
      const cx = vb.x + vb.w / 2;
      const cy = vb.y + vb.h / 2;
      const newW = vb.w * factor;
      const newH = vb.h * factor;
      return {
        x: cx - newW / 2,
        y: cy - newH / 2,
        w: newW,
        h: newH,
      };
    });
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
        onPanResponderGrant: () => {
          const vb = viewBoxRef.current;
          panStartRef.current = {
            x: 0,
            y: 0,
            vbX: vb.x,
            vbY: vb.y,
          };
          movedRef.current = false;
        },
        onPanResponderMove: (_e, g) => {
          if (!panStartRef.current) {
            return;
          }
          if (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4) {
            movedRef.current = true;
          }
          const vb = viewBoxRef.current;
          const vp = viewportRef.current;
          const scaleX = vb.w / Math.max(vp.width, 1);
          const scaleY = vb.h / Math.max(vp.height, 1);
          setViewBox({
            ...vb,
            x: panStartRef.current.vbX - g.dx * scaleX,
            y: panStartRef.current.vbY - g.dy * scaleY,
          });
        },
        onPanResponderRelease: () => {
          panStartRef.current = null;
        },
        onPanResponderTerminate: () => {
          panStartRef.current = null;
        },
      }),
    [],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setViewport({width: Math.max(width, 1), height: Math.max(height, 1)});
  };

  if (diagram.nodes.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          (no hierarchy relationships to display)
        </Text>
      </View>
    );
  }

  const {positions, nodeRadius} = layout;
  const viewBoxStr = `${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <ToolbarButton title="fit all" onPress={fitAll} />
        <ToolbarButton title="−" onPress={() => zoomBy(ZOOM_OUT)} />
        <ToolbarButton title="+" onPress={() => zoomBy(ZOOM_IN)} />
      </View>
      <View
        style={styles.canvas}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        {...panResponder.panHandlers}>
        <Svg width="100%" height="100%" viewBox={viewBoxStr}>
          <Defs>
            {diagram.relationships.map(rel => {
              const edgeColor = rel.expired ? WARNING : EDGE_MUTED;
              const arrowId = `arrow-${rel.masterFingerprint.slice(0, 8)}-${rel.childFingerprint.slice(0, 8)}`;
              return (
                <Marker
                  key={arrowId}
                  id={arrowId}
                  markerWidth={12}
                  markerHeight={10}
                  refX={10}
                  refY={5}
                  orient="auto"
                  markerUnits="userSpaceOnUse">
                  <Path d="M 0 0 L 12 5 L 0 10 L 3 5 Z" fill={edgeColor} />
                </Marker>
              );
            })}
          </Defs>
          {diagram.relationships.map(rel => {
            const from = positions.get(rel.masterFingerprint);
            const to = positions.get(rel.childFingerprint);
            if (!from || !to) {
              return null;
            }
            const d = hierarchyEdgePathD(from, to, nodeRadius);
            const edgeColor = rel.expired ? WARNING : EDGE_MUTED;
            const arrowId = `arrow-${rel.masterFingerprint.slice(0, 8)}-${rel.childFingerprint.slice(0, 8)}`;
            const master = nodeMap.get(rel.masterFingerprint);
            const child = nodeMap.get(rel.childFingerprint);
            const edgeDetail: HierarchyEdgeDetail = {
              kind: 'edge',
              masterFingerprint: rel.masterFingerprint,
              childFingerprint: rel.childFingerprint,
              masterLabel: master?.label ?? shortFp(rel.masterFingerprint),
              childLabel: child?.label ?? shortFp(rel.childFingerprint),
              context: rel.context,
              timestamp: rel.timestamp,
              expiry: rel.expiry,
              expired: rel.expired,
            };
            return (
              <G key={`${rel.masterFingerprint}:${rel.childFingerprint}`}>
                <Path
                  d={d}
                  stroke={edgeColor}
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  markerEnd={`url(#${arrowId})`}
                />
                <Path
                  d={d}
                  stroke="transparent"
                  strokeWidth={16}
                  fill="none"
                  onPress={() => {
                    if (!movedRef.current) {
                      onSelectDetail(edgeDetail);
                    }
                  }}
                />
              </G>
            );
          })}
          {diagram.nodes.map(node => {
            const pos = positions.get(node.fingerprint);
            if (!pos) {
              return null;
            }
            const nodeDetail: HierarchyNodeDetail = {
              kind: 'node',
              fingerprint: node.fingerprint,
              label: node.label,
              details: node.details,
              isSelf: node.isSelf,
              isFocus: node.isFocus,
            };
            const stroke = node.isSelf || node.isFocus ? colors.accent : '#333';
            const strokeWidth = node.isFocus ? 3 : node.isSelf ? 2.5 : 1.5;
            return (
              <G
                key={node.fingerprint}
                onPress={() => {
                  if (!movedRef.current) {
                    onSelectDetail(nodeDetail);
                  }
                }}>
                <Circle
                  cx={pos.x}
                  cy={pos.y}
                  r={nodeRadius}
                  fill={node.color}
                  stroke={stroke}
                  strokeWidth={strokeWidth}
                />
                <SvgText
                  x={pos.x}
                  y={pos.y + nodeRadius + 16}
                  fill={colors.text}
                  fontSize={11}
                  fontWeight="600"
                  textAnchor="middle">
                  {truncateLabel(node.label)}
                </SvgText>
                <SvgText
                  x={pos.x}
                  y={pos.y + nodeRadius + 28}
                  fill={colors.muted}
                  fontSize={9}
                  textAnchor="middle">
                  {shortFp(node.fingerprint)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    </View>
  );
}

function ToolbarButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}): JSX.Element {
  return (
    <Text style={styles.toolBtn} onPress={onPress}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.page,
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  toolBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    fontSize: typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  canvas: {
    height: VIEW_HEIGHT,
    width: '100%',
  },
  empty: {
    marginTop: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.page,
  },
  emptyText: {
    color: colors.muted,
    fontSize: typography.caption,
    textAlign: 'center',
  },
});
