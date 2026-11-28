import React, {useCallback, useEffect, useLayoutEffect, useState} from 'react';
import {
  BackHandler,
  FlatList,
  Pressable,
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
import {useContactNfcCapability} from '../services/contactNfc';
import {storedContactToLike} from '../services/contactDisplay';
import {shortFingerprint} from '../ebpCore';
import Screen from '../components/Screen';
import Card from '../components/Card';
import ContactListRow from '../components/ContactListRow';
import ListRow from '../components/ListRow';
import SectionTitle from '../components/SectionTitle';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import ImportContactModal from '../components/ImportContactModal';
import FetchContactModal from '../components/FetchContactModal';
import BrowseContactsModal from '../components/BrowseContactsModal';
import {colors, layout, radius, spacing, typography} from '../theme/tokens';
import {statusKind} from '../theme/statusKind';
import PlaceHeader from '../components/PlaceHeader';
import AppIcon from '../components/AppIcon';
import {usePlaceTheme} from '../theme/PlaceTheme';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactsList'>;

export default function ContactsScreen({navigation}: Props): JSX.Element {
  const theme = usePlaceTheme();
  const canReceiveNfc = useContactNfcCapability('receive');
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
          style={({pressed}) => [
            styles.headerAction,
            (pressed || menuOpen) && {backgroundColor: theme.pale},
          ]}
          onPress={() => setMenuOpen(open => !open)}>
          <AppIcon name="plus" color={theme.accent} />
        </Pressable>
      ),
    });
  }, [navigation, menuOpen, theme.accent, theme.pale]);

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

  const menuItems = [
    {
      id: 'contacts-scan-qr',
      title: 'Scan contact QR',
      open: () => navigation.navigate('ContactQrScan'),
    },
    ...(canReceiveNfc
      ? [{
          id: 'contacts-receive-nfc',
          title: 'Receive via NFC',
          open: () => navigation.navigate('ContactQrScan', {transport: 'nfc'}),
        } as const]
      : []),
    {
      id: 'contacts-import',
      title: 'Import contact manually',
      open: () => setImportVisible(true),
    },
    {
      id: 'contacts-fetch',
      title: 'Import via fingerprint',
      open: () => setFetchVisible(true),
    },
    {
      id: 'contacts-browse',
      title: 'Browse server identities',
      open: () => setBrowseVisible(true),
    },
    {
      id: 'contacts-verify-peer',
      title: 'Verify in person',
      open: () => navigation.navigate('PeerVerification'),
    },
    {
      id: 'contacts-endorsements',
      title: 'Endorsements',
      open: () => navigation.navigate('Endorsements'),
    },
  ];

  return (
    <Screen contentStyle={styles.content}>
      <BusyOverlay visible={fetching} message="Fetching contact…" />
      <FlatList
        data={contacts}
        keyExtractor={item => item.name}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        accessibilityElementsHidden={menuOpen}
        importantForAccessibility={menuOpen ? 'no-hide-descendants' : 'auto'}
        ListHeaderComponent={
          <View style={styles.intro}>
            <PlaceHeader
              title="Your people"
              subtitle="People whose public identities you’ve saved."
            />
            <StatusBanner message={status} kind={statusKind(status)} />
            <SectionTitle>{`Local contacts · ${contacts.length}`}</SectionTitle>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No contacts yet.</Text>
            <Text style={styles.empty}>
              Use + to import a contact or find their identity on your server.
            </Text>
          </View>
        }
        renderItem={({item, index}) => (
          <ContactListRow
            testID={`contact-row-${item.name}`}
            contact={storedContactToLike(item)}
            badge={item.contact.revoked ? 'Revoked' : undefined}
            badgeVariant={item.contact.revoked ? 'danger' : 'default'}
            showDivider={index < contacts.length - 1}
            onPress={() =>
              navigation.navigate('ContactDetail', {name: item.name})
            }
          />
        )}
      />
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
            {menuItems.map((item, index) => (
              <ListRow
                key={item.id}
                testID={item.id}
                title={item.title}
                showChevron={false}
                showDivider={index < menuItems.length - 1}
                onPress={() => {
                  setMenuOpen(false);
                  item.open();
                }}
              />
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
  content: {padding: 0, paddingBottom: 0},
  listContent: {paddingBottom: spacing.xl},
  intro: {
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  emptyState: {padding: layout.gutter, gap: spacing.sm},
  headerAction: {
    minWidth: layout.controlHeight,
    minHeight: layout.controlHeight,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menu: {
    position: 'absolute',
    top: 0,
    end: layout.gutter,
    width: 260,
    maxWidth: '88%',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 3},
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: '600',
  },
  empty: {color: colors.muted, fontSize: typography.body},
});
