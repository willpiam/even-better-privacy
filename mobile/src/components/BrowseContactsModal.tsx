import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  browseServerIdentities,
  type ServerIdentitySummary,
} from '../services/contacts';
import {serverIdentityToLike} from '../services/contactDisplay';
import AppButton from './AppButton';
import Card from './Card';
import ContactListRow from './ContactListRow';
import InlineBusy from './InlineBusy';
import TextField from './TextField';
import {colors, radius, spacing, typography} from '../theme/tokens';

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

export default function BrowseContactsModal({
  visible,
  knownFingerprints,
  onCancel,
  onImport,
  importingFingerprint,
}: {
  visible: boolean;
  knownFingerprints: Set<string>;
  onCancel: () => void;
  onImport: (fingerprint: string) => void | Promise<void>;
  importingFingerprint: string | null;
}): JSX.Element {
  const [browseQuery, setBrowseQuery] = useState('');
  const [serverResults, setServerResults] = useState<ServerIdentitySummary[]>(
    [],
  );
  const [browsePage, setBrowsePage] = useState(1);
  const [browsePagination, setBrowsePagination] = useState({
    total: 0,
    totalPages: 0,
  });
  const [browseLoaded, setBrowseLoaded] = useState(false);
  const [browsingLoading, setBrowsingLoading] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!visible) {
      return;
    }
    setBrowseQuery('');
    setServerResults([]);
    setBrowsePage(1);
    setBrowsePagination({total: 0, totalPages: 0});
    setBrowseLoaded(false);
    setStatus('');
  }, [visible]);

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

  const visibleServerResults = serverResults.filter(entry => !entry.revoked);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Browse server identities</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled>
            <View style={styles.browseRow}>
              <View style={styles.browseField}>
                <TextField
                  label="Search query"
                  testID="contacts-browse-query"
                  value={browseQuery}
                  onChangeText={setBrowseQuery}
                  autoCapitalize="none"
                />
              </View>
              <AppButton
                title="Browse"
                testID="contacts-browse-submit"
                onPress={onBrowse}
                disabled={browsingLoading}
                style={styles.browseBtn}
              />
            </View>

            {browsingLoading ? <InlineBusy message="Fetching directory…" /> : null}

            {!browsingLoading &&
            browseLoaded &&
            visibleServerResults.length === 0 ? (
              <Text style={styles.muted}>(none found)</Text>
            ) : null}

            {!browsingLoading && visibleServerResults.length > 0 ? (
              <Card>
                {visibleServerResults.map(entry => {
                  const isAlreadyContact = knownFingerprints.has(
                    entry.fingerprint,
                  );
                  const isImporting =
                    importingFingerprint === entry.fingerprint;
                  const subtitleExtra = [
                    `${entry.signingKeyType || '?'}/${
                      entry.encryptionKeyType || '?'
                    }`,
                    formatCreatedAt(entry.createdAt),
                  ].join(' · ');

                  return (
                    <ContactListRow
                      key={entry.fingerprint}
                      contact={serverIdentityToLike(entry)}
                      subtitleExtra={subtitleExtra}
                      showChevron={false}
                      badge={isAlreadyContact ? 'In contacts' : undefined}
                      right={
                        isAlreadyContact ? undefined : isImporting ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.accent}
                          />
                        ) : (
                          <AppButton
                            title="Import"
                            variant="secondary"
                            onPress={() => onImport(entry.fingerprint)}
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
                        browsePagination.total === 1
                          ? 'identity'
                          : 'identities'
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
                        browsePage >= browsePagination.totalPages ||
                        browsingLoading
                      }
                      style={styles.flexBtn}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <AppButton title="Close" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  modal: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: typography.title,
    fontWeight: '700',
    color: colors.text,
  },
  status: {fontSize: typography.caption, color: colors.muted},
  scroll: {flexGrow: 0},
  muted: {fontSize: typography.caption, color: colors.muted},
  browseRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginBottom: spacing.sm,
  },
  browseField: {flex: 1},
  browseBtn: {marginBottom: 0, height: 52},
  importBtn: {height: 36, paddingHorizontal: 12},
  pagination: {alignItems: 'center', gap: 8, marginTop: 4},
  paginationInfo: {fontSize: 13, color: colors.muted},
  paginationButtons: {flexDirection: 'row', gap: 8, alignSelf: 'stretch'},
  flexBtn: {flex: 1},
});
