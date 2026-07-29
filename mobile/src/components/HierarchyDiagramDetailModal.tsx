import React from 'react';
import {Modal, ScrollView, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import AppButton from './AppButton';
import {colors, radius, spacing, typography} from '../theme/tokens';

export type HierarchyNodeDetail = {
  kind: 'node';
  fingerprint: string;
  label: string;
  details: Record<string, string>;
  isSelf: boolean;
  isFocus: boolean;
};

export type HierarchyEdgeDetail = {
  kind: 'edge';
  masterFingerprint: string;
  childFingerprint: string;
  masterLabel: string;
  childLabel: string;
  context: string;
  timestamp: number;
  expiry: number;
  expired: boolean;
};

export type HierarchyDiagramDetail =
  | HierarchyNodeDetail
  | HierarchyEdgeDetail
  | null;

function formatWhen(ms: number, emptyLabel: string): string {
  if (!ms) {
    return emptyLabel;
  }
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? emptyLabel : date.toLocaleString();
}

function truncateDetailValue(val: string): string {
  if (val.length <= 128) {
    return val;
  }
  return `${val.substring(0, 64)}...${val.substring(val.length - 64)}`;
}

export default function HierarchyDiagramDetailModal({
  detail,
  onClose,
}: {
  detail: HierarchyDiagramDetail;
  onClose: () => void;
}): JSX.Element {
  const visible = detail !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>
            {detail?.kind === 'edge' ? 'Relationship' : 'Identity'}
          </Text>
          {detail?.kind === 'node' ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled">
              <View style={styles.badgeRow}>
                {detail.isSelf ? (
                  <View style={[styles.badge, styles.badgeSelf]}>
                    <Text style={styles.badgeSelfText}>YOU</Text>
                  </View>
                ) : null}
                {detail.isFocus ? (
                  <View style={[styles.badge, styles.badgeFocus]}>
                    <Text style={styles.badgeFocusText}>FOCUS</Text>
                  </View>
                ) : null}
              </View>
              <Field label="Label" value={detail.label} />
              <CopyableField label="Fingerprint" value={detail.fingerprint} />
              {Object.keys(detail.details).length === 0 ? (
                <Field label="Details" value="(no details)" />
              ) : (
                Object.entries(detail.details).map(([key, value]) => (
                  <Field
                    key={key}
                    label={key}
                    value={truncateDetailValue(value)}
                  />
                ))
              )}
            </ScrollView>
          ) : null}
          {detail?.kind === 'edge' ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled">
              {detail.expired ? (
                <View style={styles.expiredBadge}>
                  <Text style={styles.expiredText}>EXPIRED</Text>
                </View>
              ) : null}
              <Field label="Master" value={detail.masterLabel} />
              <CopyableField
                label="Master fingerprint"
                value={detail.masterFingerprint}
              />
              <Field label="Child" value={detail.childLabel} />
              <CopyableField
                label="Child fingerprint"
                value={detail.childFingerprint}
              />
              <Field
                label="Context"
                value={detail.context.trim() || 'none'}
              />
              <Field
                label="Created"
                value={formatWhen(detail.timestamp, 'unknown')}
              />
              <Field
                label="Expiry"
                value={formatWhen(detail.expiry, 'never')}
              />
            </ScrollView>
          ) : null}
          <AppButton title="Close" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Field({label, value}: {label: string; value: string}): JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

function CopyableField({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.copyRow}>
        <Text style={styles.mono} selectable>
          {value}
        </Text>
        <AppButton
          title="Copy"
          variant="secondary"
          onPress={() => Clipboard.setString(value)}
          style={styles.copyBtn}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  scroll: {flexGrow: 0},
  scrollContent: {gap: spacing.md, paddingBottom: spacing.sm},
  badgeRow: {flexDirection: 'row', gap: 8, flexWrap: 'wrap'},
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  badgeSelf: {backgroundColor: colors.accentSoft},
  badgeSelfText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  badgeFocus: {backgroundColor: colors.segmentTrack},
  badgeFocusText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  field: {gap: 6},
  value: {
    fontSize: typography.body,
    color: colors.text,
  },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  mono: {
    flex: 1,
    fontSize: typography.caption,
    color: colors.text,
    fontFamily: 'monospace',
  },
  copyBtn: {alignSelf: 'flex-start'},
  expiredBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  expiredText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
});
