import React, {useCallback, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../navigation/AppNavigator';
import {
  clearActivityLog,
  listActivityLog,
  type ActivityLogEntry,
} from '../services/activityLog';
import Screen from '../components/Screen';
import AppButton from '../components/AppButton';
import Card from '../components/Card';
import {colors} from '../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'ActivityLog'>;

export default function ActivityLogScreen(_props: Props): JSX.Element {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        setLogs(await listActivityLog());
      })();
    }, []),
  );

  return (
    <Screen scroll>
      <AppButton
        title="Clear log"
        variant="danger"
        onPress={async () => {
          await clearActivityLog();
          setLogs([]);
        }}
      />
      <Card padded>
        {logs.length === 0 ? (
          <Text style={styles.logLine}>No activity yet.</Text>
        ) : (
          logs.map(entry => (
            <Text style={styles.logLine} key={`${entry.at}-${entry.message}`}>
              [{entry.kind}] {new Date(entry.at).toLocaleString()} —{' '}
              {entry.message}
            </Text>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logLine: {
    fontSize: 11,
    color: colors.muted,
    marginBottom: 4,
  },
});
