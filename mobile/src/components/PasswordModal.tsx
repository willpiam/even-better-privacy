import React, {useEffect, useState} from 'react';
import {Modal, StyleSheet, Text, TextInput, View} from 'react-native';
import AppButton from './AppButton';
import {colors, radius, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';
import AppIcon from './AppIcon';

export default function PasswordModal({
  visible,
  title = 'Enter Password',
  placeholder = 'Password',
  submitLabel = 'Submit',
  secureTextEntry = true,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
  secureTextEntry?: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}): JSX.Element {
  const theme = usePlaceTheme();
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
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={cancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={[styles.mark, {backgroundColor: theme.pale}]}>
            <AppIcon name="lock" color={theme.accent} size={26} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            testID="password-modal-input"
            accessibilityLabel={placeholder}
            style={[styles.input, {borderColor: theme.border}]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={secureTextEntry}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            keyboardType={secureTextEntry ? 'default' : 'email-address'}
            onSubmitEditing={submit}
          />
          <View style={styles.row}>
            <AppButton
              title="Cancel"
              variant="secondary"
              onPress={cancel}
              style={styles.flex}
              testID="password-modal-cancel"
            />
            <AppButton
              title={submitLabel}
              onPress={submit}
              style={styles.flex}
              testID="password-modal-submit"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mark: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(25,42,32,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
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
