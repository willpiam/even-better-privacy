import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AppButton from './AppButton';
import StatusBanner from './StatusBanner';
import TextField from './TextField';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function ResolveOpaqueDetailModal({
  path,
  onCancel,
  onResolve,
}: {
  path: string;
  onCancel: () => void;
  onResolve: (path: string, value: string) => Promise<void>;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const cancel = () => {
    if (!submitting) {
      onCancel();
    }
  };

  const submit = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onResolve(path, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled">
          <View style={styles.modal} accessibilityViewIsModal>
            <Text style={styles.title}>Resolve opaque detail</Text>
            <Text style={styles.path} selectable>
              {path}
            </Text>
            <StatusBanner message={error} kind="error" />
            <TextField
              label="Plaintext value"
              testID="contact-resolve-value"
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              editable={!submitting}
            />
            <View style={styles.row}>
              <AppButton
                title="Cancel"
                testID="contact-resolve-cancel"
                variant="secondary"
                onPress={cancel}
                disabled={submitting}
                style={styles.flex}
              />
              <AppButton
                title="Resolve"
                testID="contact-resolve-submit"
                onPress={submit}
                loading={submitting}
                style={styles.flex}
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  content: {
    flexGrow: 1,
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
  path: {
    fontSize: typography.body,
    color: colors.muted,
  },
  row: {flexDirection: 'row', gap: spacing.sm},
  flex: {flex: 1},
});
