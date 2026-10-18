import React, {useCallback, useLayoutEffect, useMemo, useState} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  getMailSecretsStatus,
  resolveSelectedAccount,
  unlockMailSecretsWithPin,
} from '../../services/mail/accountStore';
import {
  clampMailLimit,
  listMailboxMessages,
} from '../../services/mail/imap';
import type {MailMessageSummary} from '../../services/mail/types';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import ListRow from '../../components/ListRow';
import Card from '../../components/Card';
import InlineBusy from '../../components/InlineBusy';
import StatusBanner from '../../components/StatusBanner';
import TextField from '../../components/TextField';
import {useSecretPrompt} from '../../hooks/useSecretPrompt';
import {statusKind} from '../../theme/statusKind';
import {colors, radius, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailInbox'>;

const FOLDER_PRESETS = [
  'INBOX',
  'Sent',
  'Drafts',
  'Trash',
  'Spam',
  'Custom',
] as const;

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const {promptSecret, secretPrompt} = useSecretPrompt();
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [folderPreset, setFolderPreset] =
    useState<(typeof FOLDER_PRESETS)[number]>('INBOX');
  const [customFolder, setCustomFolder] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [limitText, setLimitText] = useState('20');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const folder = useMemo(() => {
    if (folderPreset === 'Custom') {
      return customFolder.trim() || 'INBOX';
    }
    return folderPreset;
  }, [folderPreset, customFolder]);

  const limit = clampMailLimit(Number(limitText) || 20);

  const load = useCallback(
    async (pageOverride?: number) => {
      const nextPage = pageOverride ?? page;
      setLoading(true);
      setLoadError(null);
      try {
        const identityName = await getCurrentIdentityRequired();
        const secretStatus = await getMailSecretsStatus(identityName);
        const locked = secretStatus.locked && !secretStatus.inMemory;
        setSecretsLocked(locked);
        if (locked) {
          throw new Error('Mail secrets locked; unlock with PIN first');
        }
        const resolved = await resolveSelectedAccount(identityName);
        if (!resolved) {
          throw new Error('Configure a mail account first');
        }
        setAccountEmail(
          resolved.account.config.fromEmail || resolved.account.config.username,
        );
        const result = await listMailboxMessages(
          resolved.account.config,
          resolved.secrets,
          {
            folder,
            search,
            page: nextPage,
            limit,
          },
        );
        setMessages(result.messages);
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotal(result.total);
        setStatus(
          result.total === 0
            ? 'Mailbox empty'
            : `Loaded ${result.messages.length} of ${result.total} (page ${result.page}/${result.totalPages})`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        setStatus(message);
        setMessages([]);
        setAccountEmail('');
        setTotal(0);
        setTotalPages(1);
        if (message.toLowerCase().includes('mail secrets locked')) {
          setSecretsLocked(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [folder, search, limit, page],
  );

  useFocusEffect(
    useCallback(() => {
      void load(1);
      // Intentionally re-run when folder/search/limit change via dedicated handlers.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [folder, search, limit]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text
          style={styles.headerAction}
          onPress={() => navigation.navigate('MailCompose')}>
          Compose
        </Text>
      ),
    });
  }, [navigation]);

  const onUnlock = async () => {
    const pin = await promptSecret({
      title: 'Email PIN',
      placeholder: 'Email PIN',
      submitLabel: 'Unlock',
    });
    if (pin === null) {
      return;
    }
    if (!pin.trim()) {
      setStatus('Email PIN is required');
      return;
    }
    try {
      const identityName = await getCurrentIdentityRequired();
      await unlockMailSecretsWithPin(identityName, pin);
      setSecretsLocked(false);
      await load(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const emptyLabel = loadError
    ? loadError
    : 'Mailbox empty.';

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {secretPrompt}
      {accountEmail ? (
        <Text style={styles.accountEmail}>{accountEmail}</Text>
      ) : null}

      <View style={styles.folderRow}>
        {FOLDER_PRESETS.map(name => {
          const selected = folderPreset === name;
          return (
            <Pressable
              key={name}
              onPress={() => {
                setFolderPreset(name);
                setPage(1);
              }}
              style={[styles.folderChip, selected && styles.folderChipSelected]}
              accessibilityRole="button"
              accessibilityState={{selected}}>
              <Text
                style={[
                  styles.folderChipText,
                  selected && styles.folderChipTextSelected,
                ]}>
                {name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {folderPreset === 'Custom' ? (
        <TextField
          label="Custom folder"
          autoCapitalize="none"
          autoCorrect={false}
          value={customFolder}
          onChangeText={setCustomFolder}
          onBlur={() => void load(1)}
          placeholder="[Gmail]/Sent Mail"
        />
      ) : null}

      <TextField
        label="Search"
        autoCapitalize="none"
        autoCorrect={false}
        value={searchDraft}
        onChangeText={setSearchDraft}
        onSubmitEditing={() => {
          setSearch(searchDraft.trim());
          setPage(1);
        }}
        placeholder="Search mailbox text"
        returnKeyType="search"
      />
      <AppButton
        title="Search"
        variant="secondary"
        onPress={() => {
          setSearch(searchDraft.trim());
          setPage(1);
        }}
      />

      <TextField
        label="Limit (1–100)"
        keyboardType="number-pad"
        value={limitText}
        onChangeText={text => {
          setLimitText(text);
        }}
        onBlur={() => {
          const clamped = String(clampMailLimit(Number(limitText) || 20));
          setLimitText(clamped);
          setPage(1);
        }}
      />

      <View style={styles.pagerRow}>
        <AppButton
          title="Prev"
          variant="secondary"
          disabled={loading || page <= 1}
          onPress={() => void load(page - 1)}
        />
        <Text style={styles.pageInfo}>
          Page {page}/{totalPages} ({total})
        </Text>
        <AppButton
          title="Next"
          variant="secondary"
          disabled={loading || page >= totalPages}
          onPress={() => void load(page + 1)}
        />
      </View>

      <AppButton title="Refresh" variant="secondary" onPress={() => void load()} />
      <StatusBanner message={status} kind={statusKind(status)} />

      {secretsLocked ? (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedText}>
            Mail secrets are locked. Unlock to load messages.
          </Text>
          <AppButton title="Unlock secrets" onPress={() => void onUnlock()} />
          <AppButton
            title="Open Mail Accounts"
            variant="secondary"
            onPress={() => navigation.navigate('MailAccounts')}
          />
        </View>
      ) : null}

      {loading ? <InlineBusy message="Loading messages…" /> : null}
      {!loading ? (
        <Card style={styles.listCard}>
          <FlatList
            data={messages}
            keyExtractor={item => String(item.uid)}
            ListEmptyComponent={
              <Text style={[styles.empty, loadError ? styles.emptyError : null]}>
                {emptyLabel}
              </Text>
            }
            renderItem={({item}) => (
              <ListRow
                title={item.subject || '(no subject)'}
                subtitle={`${item.from} · ${item.date}`}
                onPress={() =>
                  navigation.navigate('MailMessage', {
                    uid: item.uid,
                    folder,
                  })
                }
              />
            )}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {flex: 1},
  accountEmail: {
    fontSize: typography.body,
    color: colors.muted,
  },
  headerAction: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 15,
    paddingHorizontal: 8,
  },
  folderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  folderChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  folderChipSelected: {
    borderColor: colors.accent,
    backgroundColor: '#eef6ff',
  },
  folderChipText: {
    color: colors.text,
    fontSize: typography.caption,
  },
  folderChipTextSelected: {
    color: colors.accent,
    fontWeight: '600',
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  pageInfo: {
    flex: 1,
    textAlign: 'center',
    color: colors.muted,
    fontSize: typography.caption,
  },
  listCard: {flex: 1},
  empty: {
    color: colors.muted,
    padding: 16,
  },
  emptyError: {
    color: colors.danger,
  },
  lockedBanner: {
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: '#fffbeb',
    gap: 10,
  },
  lockedText: {
    color: colors.text,
    fontSize: typography.caption,
  },
});
