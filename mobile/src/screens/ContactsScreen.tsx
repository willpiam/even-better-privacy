import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
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
  getDetailValue,
  importContact,
  listContacts,
  type ServerIdentitySummary,
  type StoredContact,
} from '../services/contacts';

type Props = NativeStackScreenProps<RootStackParamList, 'Contacts'>;

function formatCreatedAt(createdAt?: number): string {
  if (!createdAt || !Number.isFinite(createdAt)) {
    return 'unknown';
  }
  return new Date(createdAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ContactsScreen({navigation}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [contactJson, setContactJson] = useState('');
  const [contactName, setContactName] = useState('');
  const [fetchFingerprint, setFetchFingerprint] = useState('');
  const [fetchName, setFetchName] = useState('');
  const [browseQuery, setBrowseQuery] = useState('');
  const [serverResults, setServerResults] = useState<ServerIdentitySummary[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browsePagination, setBrowsePagination] = useState({
    total: 0,
    totalPages: 0,
  });
  const [browseLoaded, setBrowseLoaded] = useState(false);
  const [importingFingerprint, setImportingFingerprint] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    setContacts(await listContacts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const contactFingerprints = new Set(contacts.map(c => c.contact.fingerprint));

  const loadBrowsePage = async (page: number) => {
    const result = await browseServerIdentities({
      query: browseQuery || undefined,
      page,
    });
    setServerResults(result.identities);
    setBrowsePage(result.page);
    setBrowsePagination({
      total: result.total,
      totalPages: result.totalPages,
    });
    setBrowseLoaded(true);
    setStatus(`Loaded ${result.identities.length} server identities`);
  };

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
      await loadBrowsePage(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onBrowsePrev = async () => {
    if (browsePage <= 1) {
      return;
    }
    try {
      await loadBrowsePage(browsePage - 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onBrowseNext = async () => {
    if (browsePage >= browsePagination.totalPages) {
      return;
    }
    try {
      await loadBrowsePage(browsePage + 1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const onImportServerIdentity = async (fingerprint: string) => {
    setImportingFingerprint(fingerprint);
    try {
      await fetchContactFromServer({fingerprint});
      setStatus(`Imported ${fingerprint.substring(0, 16)}... as contact`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingFingerprint(null);
    }
  };

  const visibleServerResults = serverResults.filter(entry => !entry.revoked);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Contacts</Text>
        {status ? <Text style={styles.status}>{status}</Text> : null}

        {contacts.length === 0 ? (
          <Text style={styles.empty}>No contacts yet.</Text>
        ) : (
          contacts.map(item => (
            <TouchableOpacity
              key={item.name}
              style={styles.item}
              onPress={() =>
                navigation.navigate('ContactDetail', {name: item.name})
              }>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.fingerprint}>{item.contact.fingerprint}</Text>
            </TouchableOpacity>
          ))
        )}

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
            style={[styles.input, styles.flex, styles.rowInput]}
            value={browseQuery}
            onChangeText={setBrowseQuery}
            placeholder="Search query"
          />
          <Button title="Browse" onPress={onBrowse} />
        </View>

        {browseLoaded && visibleServerResults.length === 0 ? (
          <Text style={styles.muted}>(none found)</Text>
        ) : null}

        {visibleServerResults.map(entry => {
          const detailName = getDetailValue(entry.details, 'name');
          const detailEmail = getDetailValue(entry.details, 'email');
          const isAlreadyContact = contactFingerprints.has(entry.fingerprint);
          const isImporting = importingFingerprint === entry.fingerprint;

          return (
            <View key={entry.fingerprint} style={styles.serverItem}>
              <View style={styles.serverInfo}>
                {detailName || detailEmail ? (
                  <View style={styles.detailTags}>
                    {detailName ? (
                      <Text style={styles.detailTag}>Name: {detailName}</Text>
                    ) : null}
                    {detailEmail ? (
                      <Text style={styles.detailTag}>Email: {detailEmail}</Text>
                    ) : null}
                  </View>
                ) : null}
                <Text style={styles.fingerprint}>{entry.fingerprint}</Text>
                <Text style={styles.muted}>
                  {entry.signingKeyType || '?'}/{entry.encryptionKeyType || '?'} ·{' '}
                  {formatCreatedAt(entry.createdAt)}
                </Text>
              </View>
              <View style={styles.serverActions}>
                {isAlreadyContact ? (
                  <Text style={styles.inContacts}>In contacts</Text>
                ) : isImporting ? (
                  <ActivityIndicator size="small" color="#007AFF" />
                ) : (
                  <Button
                    title="Import"
                    onPress={() => onImportServerIdentity(entry.fingerprint)}
                  />
                )}
              </View>
            </View>
          );
        })}

        {browseLoaded && browsePagination.total > 0 ? (
          <View style={styles.pagination}>
            <Text style={styles.paginationInfo}>
              {browsePagination.totalPages <= 1
                ? `${browsePagination.total} ${
                    browsePagination.total === 1 ? 'identity' : 'identities'
                  }`
                : `Page ${browsePage} of ${browsePagination.totalPages} (${browsePagination.total} total)`}
            </Text>
            {browsePagination.totalPages > 1 ? (
              <View style={styles.paginationButtons}>
                <Button
                  title="Previous"
                  onPress={onBrowsePrev}
                  disabled={browsePage <= 1}
                />
                <Button
                  title="Next"
                  onPress={onBrowseNext}
                  disabled={browsePage >= browsePagination.totalPages}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#fff'},
  scroll: {padding: 16, paddingBottom: 32},
  header: {fontSize: 20, fontWeight: '700', marginBottom: 8, color: '#111'},
  status: {marginBottom: 8, color: '#111'},
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
  muted: {fontSize: 12, color: '#666', marginTop: 2},
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
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8},
  rowInput: {marginBottom: 0},
  flex: {flex: 1},
  serverItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  serverInfo: {flex: 1},
  serverActions: {
    justifyContent: 'center',
    minWidth: 88,
    paddingTop: 2,
  },
  detailTags: {marginBottom: 4, gap: 2},
  detailTag: {fontSize: 12, color: '#333'},
  inContacts: {fontSize: 12, color: '#2e7d32', fontWeight: '600'},
  pagination: {marginTop: 8, alignItems: 'center', gap: 8},
  paginationInfo: {fontSize: 13, color: '#333'},
  paginationButtons: {
    flexDirection: 'row',
    gap: 12,
  },
});
