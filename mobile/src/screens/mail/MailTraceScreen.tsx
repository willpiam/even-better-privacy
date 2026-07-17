import React, {useCallback, useState} from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
import {
  clearMailTrace,
  listMailTrace,
  type MailTraceEntry,
} from '../../services/mail/mailTrace';

type Props = NativeStackScreenProps<RootStackParamList, 'MailTrace'>;

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
    <SafeAreaView style={styles.container}>
      <Text style={styles.hint}>
        Newest first. Last stub before a hang is the stall point. Metro also
        shows lines tagged [ebp-mail].
      </Text>
      <View style={styles.row}>
        <Button title="Refresh" onPress={() => void refresh()} />
        <Button title="Clear" color="#c00" onPress={() => void onClear()} />
      </View>
      <FlatList
        data={entries}
        keyExtractor={item => `${item.seq}-${item.at}`}
        ListEmptyComponent={
          <Text style={styles.empty}>No mail stubs recorded yet.</Text>
        }
        renderItem={({item}) => (
          <View style={styles.item}>
            <Text style={styles.meta}>
              #{item.seq} · {formatTime(item.at)}
            </Text>
            <Text style={styles.stub}>{item.stub}</Text>
            {item.detail ? (
              <Text style={styles.detail}>{item.detail}</Text>
            ) : null}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  hint: {fontSize: 12, color: '#444', marginBottom: 8},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  empty: {color: '#555', marginTop: 12},
  item: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  meta: {fontSize: 11, color: '#666'},
  stub: {fontWeight: '600', color: '#111', marginTop: 2},
  detail: {fontSize: 12, color: '#333', marginTop: 4},
});
