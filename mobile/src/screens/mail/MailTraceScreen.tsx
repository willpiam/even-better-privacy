import React, {useCallback, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MoreStackParamList} from '../../navigation/AppNavigator';
import {
  clearMailTrace,
  listMailTrace,
  type MailTraceEntry,
} from '../../services/mail/mailTrace';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MoreStackParamList, 'MailTrace'>;

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return String(at);
  }
}

export default function MailTraceScreen(_props: Props): JSX.Element {
  const [entries, setEntries] = useState<MailTraceEntry[]>([]);

  const refresh = useCallback(async () => {
    setEntries(await listMailTrace());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onClear = async () => {
    await clearMailTrace();
    setEntries([]);
  };

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      <Text style={styles.hint}>
        Newest first. Last stub before a hang is the stall point. Metro also
        shows lines tagged [ebp-mail].
      </Text>
      <View style={styles.row}>
        <AppButton
          title="Refresh"
          testID="mail-trace-refresh"
          variant="secondary"
          onPress={() => void refresh()}
          style={styles.halfBtn}
        />
        <AppButton
          title="Clear"
          testID="mail-trace-clear"
          variant="danger"
          onPress={() => void onClear()}
          style={styles.halfBtn}
        />
      </View>
      <FlatList
        data={entries}
        keyExtractor={item => `${item.seq}-${item.at}`}
        ListEmptyComponent={
          <Text style={styles.empty}>No mail stubs recorded yet.</Text>
        }
        renderItem={({item}) => (
          <Card padded style={styles.item}>
            <Text style={styles.meta}>
              #{item.seq} · {formatTime(item.at)}
            </Text>
            <Text style={styles.stub}>{item.stub}</Text>
            {item.detail ? (
              <Text style={styles.detail}>{item.detail}</Text>
            ) : null}
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1},
  hint: {fontSize: 12, color: colors.muted},
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  halfBtn: {flex: 1},
  empty: {color: colors.muted, marginTop: 12},
  item: {marginBottom: 8},
  meta: {fontSize: 11, color: colors.muted},
  stub: {
    fontWeight: '600',
    color: colors.text,
    marginTop: 2,
    fontSize: typography.body,
  },
  detail: {fontSize: 12, color: colors.text, marginTop: 4},
});
