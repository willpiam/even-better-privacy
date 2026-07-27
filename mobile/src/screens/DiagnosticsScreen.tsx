import React, {useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {verifyArgon2NobleParity} from '../services/argon2';
import {verifyMailPbkdf2Parity} from '../services/mail/pbkdf2Native';
import {BASE_DIR} from '../services/storage';
import {appendActivityLog} from '../services/activityLog';
import Screen from '../components/Screen';
import AppButton from '../components/AppButton';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import {statusKind} from '../theme/statusKind';
import {colors, typography} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'Diagnostics'>;

export default function DiagnosticsScreen(_props: Props): JSX.Element {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  return (
    <Screen scroll>
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Parity checks</SectionTitle>
      <AppButton
        title="Verify Argon2 parity"
        variant="secondary"
        disabled={loading}
        onPress={async () => {
          setLoading(true);
          try {
            const result = await verifyArgon2NobleParity();
            const msg = result.ok
              ? 'Argon2 parity OK'
              : 'Argon2 parity FAILED';
            await appendActivityLog(msg, result.ok ? 'success' : 'error');
            setStatus(msg);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            setLoading(false);
          }
        }}
      />
      <AppButton
        title="Verify mail PBKDF2 parity"
        variant="secondary"
        disabled={loading}
        onPress={async () => {
          setLoading(true);
          try {
            const result = await verifyMailPbkdf2Parity();
            const msg = result.ok
              ? 'Mail PBKDF2 parity OK'
              : 'Mail PBKDF2 parity FAILED';
            await appendActivityLog(msg, result.ok ? 'success' : 'error');
            setStatus(msg);
          } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error));
          } finally {
            setLoading(false);
          }
        }}
      />

      <SectionTitle>System</SectionTitle>
      <Text style={styles.systemLabel}>Identity Directory</Text>
      <Text style={styles.systemPath}>{BASE_DIR}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  systemLabel: {
    color: colors.muted,
    fontWeight: '600',
    fontSize: typography.caption,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  systemPath: {
    fontSize: 12,
    color: colors.text,
  },
});
