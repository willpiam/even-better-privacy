import React, {useEffect, useState} from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AppButton from './AppButton';
import {colors, radius, spacing, typography} from '../theme/tokens';

export default function PasswordModal({
  visible,
  title = 'Enter Password',
  placeholder = 'Password',
  submitLabel = 'Submit',
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}): JSX.Element {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (visible) {
      setPassword('');
    }
  }, [visible]);

  const submit = () => {
    onSubmit(password);
    setPassword('');
  };

  const cancel = () => {
    setPassword('');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder={placeholder}
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            onSubmitEditing={submit}
          />
          <View style={styles.row}>
            <AppButton
              title="Cancel"
              variant="secondary"
              onPress={cancel}
              style={styles.flex}
            />
            <AppButton
              title={submitLabel}
              onPress={submit}
              style={styles.flex}
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
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: typography.body,
    backgroundColor: colors.surface,
  },
  row: {flexDirection: 'row', gap: 8},
  flex: {flex: 1},
});
