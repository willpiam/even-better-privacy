import React, {useMemo} from 'react';
import {Modal, ScrollView, StyleSheet, Text, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {hexToString, isHierarchyCertificateExpired} from '../ebpCore';
import AppButton from './AppButton';
import CopyableOutput from './CopyableOutput';
import {colors, radius, spacing, typography} from '../theme/tokens';

export type CertificateDetail = {
  certificate: string;
  masterFingerprint: string;
  childFingerprint: string;
  timestamp: number;
  expiry: number;
  context: string;
};

function formatWhen(ms: number, emptyLabel: string): string {
  if (!ms) {
    return emptyLabel;
  }
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? emptyLabel : date.toLocaleString();
}

function rawCertificateText(certificate: string): string {
  try {
    return JSON.stringify(JSON.parse(hexToString(certificate)), null, 2);
  } catch {
    return certificate || '(certificate data not available)';
  }
}

export default function CertificateDetailModal({
  certificate,
  onClose,
}: {
  certificate: CertificateDetail | null;
  onClose: () => void;
}): JSX.Element {
  const visible = certificate !== null;
  const expired = certificate
    ? isHierarchyCertificateExpired({expiry: certificate.expiry})
    : false;
  const raw = useMemo(
    () => (certificate ? rawCertificateText(certificate.certificate) : ''),
    [certificate],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Certificate Details</Text>
          {certificate ? (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled">
              {expired ? (
                <View style={styles.expiredBadge}>
                  <Text style={styles.expiredText}>EXPIRED</Text>
                </View>
              ) : null}
              <CopyableField
                label="Master fingerprint"
                value={certificate.masterFingerprint}
              />
              <CopyableField
                label="Child fingerprint"
                value={certificate.childFingerprint}
              />
              <Field
                label="Context"
                value={certificate.context.trim() || 'none'}
              />
              <Field
                label="Created"
                value={formatWhen(certificate.timestamp, 'unknown')}
              />
              <Field
                label="Expiry"
                value={formatWhen(certificate.expiry, 'never')}
              />
              <Text style={styles.section}>Raw certificate</Text>
              <CopyableOutput value={raw} />
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
  section: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
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
