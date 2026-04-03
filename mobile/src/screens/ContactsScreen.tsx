import React, {useCallback, useState} from 'react';
import {
  Button,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../navigation/AppNavigator';
import {
  browseServerIdentities,
  fetchContactFromServer,
  importContact,
  listContacts,
  type StoredContact,
} from '../services/contacts';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

export default function ContactsScreen({navigation}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [contactJson, setContactJson] = useState('');
  const [contactName, setContactName] = useState('');
  const [fetchFingerprint, setFetchFingerprint] = useState('');
  const [fetchName, setFetchName] = useState('');
  const [browseQuery, setBrowseQuery] = useState('');
  const [serverResults, setServerResults] = useState<
    Array<{fingerprint: string; details: Record<string, [string, string]>}>
  >([]);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    setContacts(await listContacts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const onImport = async () => {
    try {
      await importContact(contactJson, contactName || undefined);
      setStatus('Contact imported');
      setContactJson('');
      setContactName('');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onFetch = async () => {
    try {
      await fetchContactFromServer({
        fingerprint: fetchFingerprint,
        name: fetchName || undefined,
      });
      setStatus('Contact fetched');
      setFetchFingerprint('');
      setFetchName('');
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onBrowse = async () => {
    try {
      const result = await browseServerIdentities({
        query: browseQuery || undefined,
        page: 1,
      });
      setServerResults(
        result.identities.map(identity => ({
          fingerprint: identity.fingerprint,
          details: identity.details,
        })),
      );
      setStatus(`Loaded ${result.identities.length} server identities`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Contacts</Text>
      {status ? <Text style={styles.status}>{status}</Text> : null}
      <FlatList
        data={contacts}
        keyExtractor={item => item.name}
        style={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No contacts yet.</Text>}
        renderItem={({item}) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => navigation.navigate('ContactDetail', {name: item.name})}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.fingerprint}>{item.contact.fingerprint}</Text>
          </TouchableOpacity>
        )}
      />

      <Text style={styles.section}>Import Contact</Text>
      <TextInput
        style={[styles.input, styles.multi]}
        value={contactJson}
        onChangeText={setContactJson}
        placeholder="Paste contact JSON"
        multiline
      />
      <TextInput
        style={styles.input}
        value={contactName}
        onChangeText={setContactName}
        placeholder="Name (optional)"
      />
      <Button title="Import Contact" onPress={onImport} />

      <Text style={styles.section}>Fetch From Server</Text>
      <TextInput
        style={styles.input}
        value={fetchFingerprint}
        onChangeText={setFetchFingerprint}
        placeholder="Fingerprint"
      />
      <TextInput
        style={styles.input}
        value={fetchName}
        onChangeText={setFetchName}
        placeholder="Save as (optional)"
      />
      <Button title="Fetch Contact" onPress={onFetch} />

      <Text style={styles.section}>Browse Server</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flex]}
          value={browseQuery}
          onChangeText={setBrowseQuery}
          placeholder="Search query"
        />
        <Button title="Browse" onPress={onBrowse} />
      </View>
      <FlatList
        data={serverResults}
        keyExtractor={item => item.fingerprint}
        style={styles.serverList}
        renderItem={({item}) => (
          <View style={styles.serverItem}>
            <Text style={styles.fingerprint}>{item.fingerprint}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 16, backgroundColor: '#fff'},
  header: {fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#111'},
  status: {marginBottom: 8, color: '#111'},
  list: {maxHeight: 220, marginBottom: 10},
  item: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  name: {fontWeight: '700', color: '#111'},
  fingerprint: {fontSize: 12, color: '#333', marginTop: 2},
  empty: {color: '#333', marginBottom: 8},
  section: {marginTop: 10, marginBottom: 6, fontWeight: '600', color: '#111'},
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    color: '#111',
  },
  multi: {minHeight: 80, textAlignVertical: 'top'},
  row: {flexDirection: 'row', alignItems: 'center', gap: 8},
  flex: {flex: 1},
  serverList: {maxHeight: 120, marginTop: 6},
  serverItem: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
  },
});
