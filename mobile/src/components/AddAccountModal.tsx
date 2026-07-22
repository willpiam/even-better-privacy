import React from 'react';
import {Modal, StyleSheet, Text, View} from 'react-native';
import AppButton from './AppButton';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function AddAccountModal({
  visible,
  onCancel,
  onManual,
  onGmail,
  onOutlook,
}: {
  visible: boolean;
  onCancel: () => void;
  onManual: () => void;
  onGmail: () => void;
  onOutlook: () => void;
}): JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Add account</Text>
          <AppButton title="Add manual account" onPress={onManual} />
          <AppButton
            title="Link Gmail (OAuth)"
            variant="secondary"
            onPress={onGmail}
          />
          <AppButton
            title="Link Outlook (OAuth)"
            variant="secondary"
            onPress={onOutlook}
          />
          <AppButton title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
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
    maxWidth: 420,
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
});
