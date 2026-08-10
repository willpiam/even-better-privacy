import React, {useCallback, useState} from 'react';
import {StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {
  fetchContactFromServer,
  importContact,
  listContacts,
  type StoredContact,
} from '../services/contacts';
import {storedContactToLike} from '../services/contactDisplay';
import {shortFingerprint} from '../ebpCore';
import Screen from '../components/Screen';
import Card from '../components/Card';
import ContactListRow from '../components/ContactListRow';
import SectionTitle from '../components/SectionTitle';
import AppButton from '../components/AppButton';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import ImportContactModal from '../components/ImportContactModal';
import FetchContactModal from '../components/FetchContactModal';
import BrowseContactsModal from '../components/BrowseContactsModal';
import {colors} from '../theme/tokens';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactsList'>;

export default function ContactsScreen({navigation}: Props): JSX.Element {
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [importVisible, setImportVisible] = useState(false);
  const [fetchVisible, setFetchVisible] = useState(false);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [fetching, setFetching] = useState(false);
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

  const onImport = async (json: string, name?: string) => {
    await importContact(json, name);
    setStatus('Contact imported');
    setImportVisible(false);
    await refresh();
  };

  const onFetch = async (fingerprint: string, name?: string) => {
    setFetching(true);
    try {
      await fetchContactFromServer({fingerprint, name});
      setStatus('Contact fetched');
      setFetchVisible(false);
      await refresh();
    } finally {
      setFetching(false);
    }
  };

  const onImportServerIdentity = async (fingerprint: string) => {
    setImportingFingerprint(fingerprint);
    try {
      await fetchContactFromServer({fingerprint});
      setStatus(`Imported ${shortFingerprint(fingerprint)} as contact`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingFingerprint(null);
    }
  };

  return (
    <Screen scroll>
      <BusyOverlay visible={fetching} message="Fetching contact…" />
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Local</SectionTitle>
      {contacts.length === 0 ? (
        <Text style={styles.empty}>No contacts yet.</Text>
      ) : (
        <Card>
          {contacts.map(item => (
            <ContactListRow
              key={item.name}
              contact={storedContactToLike(item)}
              onPress={() =>
                navigation.navigate('ContactDetail', {name: item.name})
              }
            />
          ))}
        </Card>
      )}

      <AppButton
        title="Import contact manually"
        onPress={() => setImportVisible(true)}
      />
      <AppButton
        title="Import via fingerprint"
        variant="secondary"
        onPress={() => setFetchVisible(true)}
      />
      <AppButton
        title="Browse server identities"
        variant="secondary"
        onPress={() => setBrowseVisible(true)}
      />

      <ImportContactModal
        visible={importVisible}
        onCancel={() => setImportVisible(false)}
        onImport={onImport}
      />
      <FetchContactModal
        visible={fetchVisible}
        busy={fetching}
        onCancel={() => setFetchVisible(false)}
        onFetch={onFetch}
      />
      <BrowseContactsModal
        visible={browseVisible}
        knownFingerprints={contactFingerprints}
        onCancel={() => setBrowseVisible(false)}
        onImport={onImportServerIdentity}
        importingFingerprint={importingFingerprint}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {color: colors.muted, marginBottom: 4},
});
