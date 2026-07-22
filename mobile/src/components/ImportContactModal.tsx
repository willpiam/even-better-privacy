import React, {useEffect, useState} from 'react';
import {Modal, StyleSheet, Text, View} from 'react-native';
import AppButton from './AppButton';
import TextField from './TextField';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function ImportContactModal({
  visible,
  onCancel,
  onImport,
}: {
  visible: boolean;
  onCancel: () => void;
  onImport: (json: string, name?: string) => void | Promise<void>;
}): JSX.Element {
  const [contactJson, setContactJson] = useState('');
  const [contactName, setContactName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setContactJson('');
      setContactName('');
      setSubmitting(false);
      setError('');
    }
  }, [visible]);

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await onImport(contactJson, contactName.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Import contact manually</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextField
            label="Contact JSON"
            value={contactJson}
            onChangeText={setContactJson}
            placeholder="Paste contact JSON"
            multiline
            autoCapitalize="none"
          />
          <TextField
            label="Name (optional)"
            value={contactName}
            onChangeText={setContactName}
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <AppButton
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              style={styles.flex}
              disabled={submitting}
            />
            <AppButton
              title="Import"
              onPress={submit}
              style={styles.flex}
              disabled={submitting}
            />
          </View>
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
  error: {fontSize: typography.caption, color: colors.danger},
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
});
