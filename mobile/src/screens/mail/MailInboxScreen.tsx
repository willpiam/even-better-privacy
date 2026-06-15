import React, {useCallback, useState} from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {listInboxMessages} from '../../services/mail/imap';
import type {MailMessageSummary} from '../../services/mail/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MailInbox'>;

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const identityName = await getCurrentIdentityRequired();
      const resolved = await resolveSelectedAccount(identityName);
      if (!resolved) {
        throw new Error('Configure a mail account first');
      }
      const list = await listInboxMessages(
        resolved.account.config,
        resolved.secrets,
        40,
      );
      setMessages(list);
      setStatus(`Loaded ${list.length} messages`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMessages([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.container}>
      <Button title="Refresh inbox" onPress={load} />
      <Button title="Compose" onPress={() => navigation.navigate('MailCompose')} />
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <FlatList
        data={messages}
        keyExtractor={item => String(item.uid)}
        ListEmptyComponent={<Text style={styles.empty}>No messages loaded.</Text>}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => navigation.navigate('MailMessage', {uid: item.uid})}>
            <Text style={styles.subject}>{item.subject}</Text>
            <Text style={styles.meta}>{item.from}</Text>
            <Text style={styles.meta}>{item.date}</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  status: {marginVertical: 8, color: '#111'},
  empty: {color: '#555', marginTop: 12},
  item: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  subject: {fontWeight: '600', color: '#111'},
  meta: {fontSize: 12, color: '#444', marginTop: 2},
});
