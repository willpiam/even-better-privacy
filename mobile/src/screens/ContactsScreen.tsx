import React, {useCallback, useEffect, useLayoutEffect, useState} from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import ImportContactModal from '../components/ImportContactModal';
import FetchContactModal from '../components/FetchContactModal';
import BrowseContactsModal from '../components/BrowseContactsModal';
import {colors, typography} from '../theme/tokens';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactsList'>;

export default function ContactsScreen({navigation}: Props): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contacts, setContacts] = useState<StoredContact[]>([]);
  const [importVisible, setImportVisible] = useState(false);
  const [fetchVisible, setFetchVisible] = useState(false);
  const [browseVisible, setBrowseVisible] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [importingFingerprint, setImportingFingerprint] = useState<
    string | null
  >(null);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    setContacts(await listContacts());
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return () => setMenuOpen(false);
    }, [refresh]),
  );

  useEffect(() => {
    if (!menuOpen) return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        setMenuOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [menuOpen]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          testID="contacts-add"
          accessibilityRole="button"
          accessibilityLabel="Add contact"
          accessibilityState={{expanded: menuOpen}}
          style={styles.headerAction}
          onPress={() => setMenuOpen(open => !open)}>
          <Text style={styles.headerActionText}>+</Text>
        </Pressable>
      ),
    });
  }, [navigation, menuOpen]);

  const contactFingerprints = new Set(contacts.map(c => c.contact.fingerprint));

  const onImport = async (json: string, name?: string) => {
    await importContact(json, name);
    setStatus('Contact imported');
    setImportVisible(false);
    await refresh();
  };

  const onFetch = async (
    fingerprint: string,
    name?: string,
    server?: string,
  ) => {
    setFetching(true);
    try {
      await fetchContactFromServer({fingerprint, name, server});
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
    <Screen contentStyle={styles.content}>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}>
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
                testID={`contact-row-${item.name}`}
                contact={storedContactToLike(item)}
                badge={item.contact.revoked ? 'REVOKED' : undefined}
                badgeVariant={item.contact.revoked ? 'danger' : 'default'}
                onPress={() =>
                  navigation.navigate('ContactDetail', {name: item.name})
                }
              />
            ))}
          </Card>
        )}
      </ScrollView>
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            testID="contacts-menu-dismiss"
            accessibilityRole="button"
            accessibilityLabel="Dismiss contact menu"
            style={StyleSheet.absoluteFill}
            onPress={() => setMenuOpen(false)}
          />
          <Card style={styles.menu}>
            {[
              {
                id: 'contacts-import',
                title: 'Import contact manually',
                open: setImportVisible,
              },
              {
                id: 'contacts-fetch',
                title: 'Import via fingerprint',
                open: setFetchVisible,
              },
              {
                id: 'contacts-browse',
                title: 'Browse server identities',
                open: setBrowseVisible,
              },
            ].map((item, index) => (
              <Pressable
                key={item.id}
                testID={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.title}
                style={[styles.menuItem, index > 0 && styles.menuDivider]}
                onPress={() => {
                  setMenuOpen(false);
                  item.open(true);
                }}>
                <Text style={styles.menuText}>{item.title}</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}

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
  content: {flex: 1},
  body: {flex: 1},
  bodyContent: {gap: 10, paddingBottom: 96},
  headerAction: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActionText: {color: colors.accent, fontSize: 24, fontWeight: '500'},
  menu: {
    position: 'absolute',
    top: 0,
    right: 12,
    width: 260,
    maxWidth: '100%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  menuItem: {minHeight: 48, justifyContent: 'center', padding: 14},
  menuDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  menuText: {fontSize: typography.body, color: colors.accent},
  empty: {color: colors.muted, marginBottom: 4},
});
