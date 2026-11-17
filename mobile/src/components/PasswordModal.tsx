import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  AppState,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import AppButton from './AppButton';
import {colors, radius, spacing, typography} from '../theme/tokens';
import {usePlaceTheme} from '../theme/PlaceTheme';
import AppIcon from './AppIcon';

export default function PasswordModal({
  visible,
  requestId,
  title = 'Enter Password',
  placeholder = 'Password',
  submitLabel = 'Submit',
  secureTextEntry = true,
  onCancel,
  onSubmit,
  biometricUnlock,
  onBiometricEnrollmentChange,
}: {
  visible: boolean;
  // Distinguishes new requests that replace an already visible dialog.
  requestId?: number;
  title?: string;
  placeholder?: string;
  submitLabel?: string;
  secureTextEntry?: boolean;
  biometricUnlock?: () => Promise<void>;
  onBiometricEnrollmentChange?: (enabled: boolean) => void;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}): JSX.Element {
  const theme = usePlaceTheme();
  const [password, setPassword] = useState('');
  const [enrollBiometrics, setEnrollBiometrics] = useState(false);
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [biometricError, setBiometricError] = useState('');
  const [shown, setShown] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const requestRef = useRef<object | null>(null);
  const autoAttempted = useRef(false);
  const biometricInFlight = useRef(false);

  useEffect(() => {
    requestRef.current = {};
    autoAttempted.current = false;
    setPassword('');
    setEnrollBiometrics(false);
    setBiometricError('');
    if (!visible) setShown(false);
    return () => {
      requestRef.current = null;
    };
  }, [visible, requestId]);

  useEffect(() => {
    if (!visible) return;
    setAppState(AppState.currentState);
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, [visible]);

  const runBiometricUnlock = useCallback(async () => {
    if (
      !visible ||
      !shown ||
      AppState.currentState !== 'active' ||
      requestRef.current === null ||
      !biometricUnlock ||
      biometricInFlight.current
    )
      return;
    // Mark manual attempts too, so returning from the native prompt never retries.
    autoAttempted.current = true;
    biometricInFlight.current = true;
    const request = requestRef.current;
    setBiometricBusy(true);
    setBiometricError('');
    try {
      await biometricUnlock();
    } catch {
      if (request !== null && requestRef.current === request)
        setBiometricError(
          'Biometric unlock failed. Use your password or try again.',
        );
    } finally {
      biometricInFlight.current = false;
      if (requestRef.current !== null) setBiometricBusy(false);
    }
  }, [visible, shown, biometricUnlock]);

  useEffect(() => {
    // onShow avoids presenting native authentication during the modal animation.
    if (visible && shown && appState === 'active' && !autoAttempted.current)
      runBiometricUnlock();
  }, [visible, requestId, shown, appState, biometricBusy, runBiometricUnlock]);

  const submit = () => {
    if (biometricInFlight.current) return;
    onSubmit(password);
    setPassword('');
  };

  const cancel = () => {
    if (biometricInFlight.current) return;
    setPassword('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onShow={() => {
        if (visible) setShown(true);
      }}
      onRequestClose={biometricBusy ? () => {} : cancel}>
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
            editable={!biometricBusy}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={secureTextEntry}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={!biometricUnlock}
            keyboardType={secureTextEntry ? 'default' : 'email-address'}
            onSubmitEditing={submit}
          />
          {biometricUnlock ? (
            <AppButton
              title="Use biometrics"
              variant="secondary"
              testID="identity-biometric-unlock"
              disabled={biometricBusy}
              onPress={runBiometricUnlock}
            />
          ) : null}
          {onBiometricEnrollmentChange ? (
            <View style={styles.row}>
              <Text style={styles.enrollmentLabel}>
                Set up biometric unlock
              </Text>
              <Switch
                accessibilityLabel="Set up biometric unlock"
                disabled={biometricBusy}
                value={enrollBiometrics}
                onValueChange={enabled => {
                  setEnrollBiometrics(enabled);
                  onBiometricEnrollmentChange(enabled);
                }}
              />
            </View>
          ) : null}
          {biometricError ? (
            <Text accessibilityRole="alert">{biometricError}</Text>
          ) : null}
          <View style={styles.row}>
            <AppButton
              title="Cancel"
              disabled={biometricBusy}
              variant="secondary"
              onPress={cancel}
              style={styles.flex}
              testID="password-modal-cancel"
            />
            <AppButton
              title={submitLabel}
              disabled={biometricBusy}
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
  enrollmentLabel: {flex: 1, color: colors.text, alignSelf: 'center'},
});
