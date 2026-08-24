import React, {useEffect, useState} from 'react';
import {Modal, StyleSheet, Text, View} from 'react-native';
import AppButton from './AppButton';
import TextField from './TextField';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function FetchContactModal({
  visible,
  busy = false,
  onCancel,
  onFetch,
}: {
  visible: boolean;
  busy?: boolean;
  onCancel: () => void;
  onFetch: (fingerprint: string, name?: string) => void | Promise<void>;
}): JSX.Element {
  const [fingerprint, setFingerprint] = useState('');
  const [saveAs, setSaveAs] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setFingerprint('');
      setSaveAs('');
      setError('');
    }
  }, [visible]);

  const submit = async () => {
    setError('');
    try {
      await onFetch(fingerprint, saveAs.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <Text style={styles.title}>Import via fingerprint</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextField
            label="Fingerprint"
            testID="contacts-fetch-fingerprint"
            value={fingerprint}
            onChangeText={setFingerprint}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            label="Save as (optional)"
            testID="contacts-fetch-save-as"
            value={saveAs}
            onChangeText={setSaveAs}
            autoCapitalize="none"
          />
          <View style={styles.row}>
            <AppButton
              title="Cancel"
              variant="secondary"
              onPress={onCancel}
              style={styles.flex}
              disabled={busy}
            />
            <AppButton
              title="Fetch"
              testID="contacts-fetch-submit"
              onPress={submit}
              style={styles.flex}
              disabled={busy}
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
