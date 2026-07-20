import React, {useCallback, useState} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {ContactsStackParamList} from '../navigation/AppNavigator';
import {
  browseServerIdentities,
  fetchContactFromServer,
  getDetailValue,
  importContact,
  listContacts,
  type ServerIdentitySummary,
  type StoredContact,
} from '../services/contacts';
import Screen from '../components/Screen';
import Card from '../components/Card';
import ListRow from '../components/ListRow';
import SectionTitle from '../components/SectionTitle';
import TextField from '../components/TextField';
import AppButton from '../components/AppButton';
import StatusBanner from '../components/StatusBanner';
import BusyOverlay from '../components/BusyOverlay';
import InlineBusy from '../components/InlineBusy';
import {colors, typography} from '../theme/tokens';
import {statusKind} from '../theme/statusKind';

type Props = NativeStackScreenProps<ContactsStackParamList, 'ContactsList'>;

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

function truncateFp(fp: string): string {
  if (fp.length <= 16) {
    return fp;
  }
  return `${fp.slice(0, 8)}…${fp.slice(-4)}`;
}

function contactSubtitle(item: StoredContact): string {
  const email =
    getDetailValue(item.contact.details, 'email') ||
    item.contact.resolvedOpaqueDetails?.['opaque::email'];
  if (email) {
    return email;
  }
  return truncateFp(item.contact.fingerprint);
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
  const [browsingLoading, setBrowsingLoading] = useState(false);
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

  const loadBrowsePage = async (page: number) => {
    setBrowsingLoading(true);
    try {
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
    } finally {
      setBrowsingLoading(false);
    }
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
    setFetching(true);
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
    } finally {
      setFetching(false);
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
    <Screen scroll>
      <BusyOverlay visible={fetching} message="Fetching contact…" />
      <StatusBanner message={status} kind={statusKind(status)} />

      <SectionTitle>Local</SectionTitle>
      {contacts.length === 0 ? (
        <Text style={styles.empty}>No contacts yet.</Text>
      ) : (
        <Card>
          {contacts.map(item => (
            <ListRow
              key={item.name}
              avatarText={item.name}
              title={item.name}
              subtitle={contactSubtitle(item)}
              onPress={() =>
                navigation.navigate('ContactDetail', {name: item.name})
              }
            />
          ))}
        </Card>
      )}

      <SectionTitle>Import</SectionTitle>
      <TextField
        label="Contact JSON"
        value={contactJson}
        onChangeText={setContactJson}
        placeholder="Paste contact JSON"
        multiline
        autoCapitalize="none"
      />
      <TextField
        label="Name (optional)"
        value={contactName}
        onChangeText={setContactName}
        autoCapitalize="none"
      />
      <AppButton title="Import Contact" onPress={onImport} />

      <SectionTitle>Fetch</SectionTitle>
      <TextField
        label="Fingerprint"
        value={fetchFingerprint}
        onChangeText={setFetchFingerprint}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Save as (optional)"
        value={fetchName}
        onChangeText={setFetchName}
        autoCapitalize="none"
      />
      <AppButton title="Fetch Contact" onPress={onFetch} disabled={fetching} />

      <SectionTitle>Browse</SectionTitle>
      <View style={styles.browseRow}>
        <View style={styles.browseField}>
          <TextField
            label="Search query"
            value={browseQuery}
            onChangeText={setBrowseQuery}
            autoCapitalize="none"
          />
        </View>
        <AppButton
          title="Browse"
          onPress={onBrowse}
          disabled={browsingLoading}
          style={styles.browseBtn}
        />
      </View>

      {browsingLoading ? <InlineBusy message="Fetching directory…" /> : null}

      {!browsingLoading && browseLoaded && visibleServerResults.length === 0 ? (
        <Text style={styles.muted}>(none found)</Text>
      ) : null}

      {!browsingLoading && visibleServerResults.length > 0 ? (
        <Card>
          {visibleServerResults.map(entry => {
            const detailName = getDetailValue(entry.details, 'name');
            const detailEmail = getDetailValue(entry.details, 'email');
            const isAlreadyContact = contactFingerprints.has(entry.fingerprint);
            const isImporting = importingFingerprint === entry.fingerprint;
            const title = detailName || truncateFp(entry.fingerprint);
            const subtitle = [
              detailEmail,
              `${entry.signingKeyType || '?'}/${entry.encryptionKeyType || '?'}`,
              formatCreatedAt(entry.createdAt),
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <ListRow
                key={entry.fingerprint}
                avatarText={title}
                title={title}
                subtitle={subtitle || truncateFp(entry.fingerprint)}
                showChevron={false}
                badge={isAlreadyContact ? 'In contacts' : undefined}
                right={
                  isAlreadyContact ? undefined : isImporting ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <AppButton
                      title="Import"
                      variant="secondary"
                      onPress={() => onImportServerIdentity(entry.fingerprint)}
                      style={styles.importBtn}
                    />
                  )
                }
              />
            );
          })}
        </Card>
      ) : null}

      {!browsingLoading && browseLoaded && browsePagination.total > 0 ? (
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
              <AppButton
                title="Previous"
                variant="secondary"
                onPress={onBrowsePrev}
                disabled={browsePage <= 1 || browsingLoading}
                style={styles.flexBtn}
              />
              <AppButton
                title="Next"
                variant="secondary"
                onPress={onBrowseNext}
                disabled={
                  browsePage >= browsePagination.totalPages || browsingLoading
                }
                style={styles.flexBtn}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: {color: colors.muted, marginBottom: 4},
  muted: {fontSize: typography.caption, color: colors.muted},
  browseRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  browseField: {flex: 1},
  browseBtn: {marginBottom: 0, height: 52},
  importBtn: {height: 36, paddingHorizontal: 12},
  pagination: {alignItems: 'center', gap: 8, marginTop: 4},
  paginationInfo: {fontSize: 13, color: colors.muted},
  paginationButtons: {flexDirection: 'row', gap: 8, alignSelf: 'stretch'},
  flexBtn: {flex: 1},
});
