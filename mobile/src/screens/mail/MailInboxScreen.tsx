import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {FlatList, Pressable, StyleSheet, Text, View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {
  getMailSecretsStatus,
  resolveSelectedAccount,
} from '../../services/mail/accountStore';
import {isSentFolderRequest} from '../../../../common/SentMailbox';
import {clampMailLimit} from '../../services/mail/imap';
import {
  getCachedMailPage,
  refreshMailPage,
  invalidateMailBodies,
} from '../../services/mail/mailData';
import {onMailCacheCleared} from '../../services/mail/mailCache';
import type {ListMailboxMessagesResult} from '../../services/mail/imap';
import type {MailMessageSummary} from '../../services/mail/types';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import ListRow from '../../components/ListRow';
import Card from '../../components/Card';
import InlineBusy from '../../components/InlineBusy';
import StatusBanner from '../../components/StatusBanner';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {statusKind} from '../../theme/statusKind';
import {colors, radius, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailInbox'>;

function emptyMailboxStatus(folder: string, found: boolean): string {
  if (isSentFolderRequest(folder)) {
    return found ? 'No sent messages' : 'No Sent mailbox on this account yet';
  }
  return 'Mailbox empty';
}

const FOLDER_PRESETS = [
  'INBOX',
  'Sent',
  'Drafts',
  'Trash',
  'Spam',
  'Custom',
] as const;

const MailSummaryRow = React.memo(function MailSummaryRow({
  item,
  sent,
  onOpen,
}: {
  item: MailMessageSummary;
  sent: boolean;
  onOpen: (uid: number) => void;
}) {
  return (
    <ListRow
      title={item.subject || '(no subject)'}
      subtitle={`${sent ? `To: ${item.to || '(unknown)'}` : item.from} · ${
        item.date
      }`}
      onPress={() => onOpen(item.uid)}
    />
  );
});
const messageKey = (item: MailMessageSummary) => String(item.uid);

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [openedFolder, setOpenedFolder] = useState('INBOX');
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [folderPreset, setFolderPreset] =
    useState<(typeof FOLDER_PRESETS)[number]>('INBOX');
  const [customFolder, setCustomFolder] = useState('');
  const [customFolderDraft, setCustomFolderDraft] = useState('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [limitText, setLimitText] = useState('20');
  const [limit, setLimit] = useState(20);
  const requestId = useRef(0);
  const pageRef = useRef(1);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const folder = useMemo(() => {
    if (folderPreset === 'Custom') {
      return customFolder.trim() || 'INBOX';
    }
    return folderPreset;
  }, [folderPreset, customFolder]);

  React.useEffect(
    () =>
      onMailCacheCleared(() => {
        requestId.current++;
        setMessages([]);
        setAccountEmail('');
        setTotal(0);
        setTotalPages(1);
        setLoading(false);
      }),
    [],
  );

  const load = useCallback(
    async (pageOverride?: number, refresh = false) => {
      const currentRequest = ++requestId.current;
      const current = () => currentRequest === requestId.current;
      const nextPage = pageOverride ?? pageRef.current;
      let cached: ListMailboxMessagesResult | undefined;
      const applyResult = (result: ListMailboxMessagesResult) => {
        setMessages(result.messages);
        setOpenedFolder(result.folder);
        pageRef.current = result.page;
        setPage(result.page);
        setTotalPages(result.totalPages);
        setTotal(result.total);
        setStatus(
          result.total === 0
            ? emptyMailboxStatus(folder, result.found)
            : `Loaded ${result.messages.length} of ${result.total} (page ${result.page}/${result.totalPages})`,
        );
      };
      setLoading(true);
      setLoadError(null);
      try {
        const identityName = await getCurrentIdentityRequired();
        const secretStatus = await getMailSecretsStatus(identityName);
        if (!current()) return;
        const locked = secretStatus.locked && !secretStatus.inMemory;
        setSecretsLocked(locked);
        if (locked) {
          throw new Error('Mail secrets locked; unlock your identity first');
        }
        const resolved = await resolveSelectedAccount(identityName);
        if (!current()) return;
        if (!resolved) {
          throw new Error('Configure a mail account first');
        }
        setAccountEmail(
          resolved.account.config.fromEmail || resolved.account.config.username,
        );
        const params = {folder, search, page: nextPage, limit};
        cached = getCachedMailPage(identityName, resolved, params);
        if (cached) applyResult(cached);
        else {
          setMessages([]);
          setTotal(0);
          setTotalPages(1);
        }
        if (refresh) invalidateMailBodies();
        const result = await refreshMailPage(identityName, resolved, params);
        if (current()) applyResult(result);
      } catch (error) {
        if (!current()) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        setStatus(message);
        if (!cached) {
          setMessages([]);
          setAccountEmail('');
          setTotal(0);
          setTotalPages(1);
        }
        if (message.toLowerCase().includes('mail secrets locked')) {
          setSecretsLocked(true);
        }
      } finally {
        if (current()) setLoading(false);
      }
    },
    [folder, search, limit],
  );

  useFocusEffect(
    useCallback(() => {
      void load(pageRef.current);
      return () => {
        requestId.current++;
      };
    }, [load]),
  );

  useLayoutEffect(() => {
    const title = isSentFolderRequest(folder)
      ? 'Sent'
      : folder === 'INBOX'
      ? 'Inbox'
      : folder;
    navigation.setOptions({
      title,
      headerRight: () => (
        <Text
          style={styles.headerAction}
          onPress={() => navigation.navigate('MailCompose')}>
          Compose
        </Text>
      ),
    });
  }, [navigation, folder]);

  const onUnlock = async () => {
    try {
      if (!(await ensureUnlocked())) return;
      setSecretsLocked(false);
      await load(1);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const openMessage = useCallback(
    (uid: number) => {
      navigation.navigate('MailMessage', {uid, folder: openedFolder});
    },
    [navigation, openedFolder],
  );
  const sent = isSentFolderRequest(folder);
  const renderMessage = useCallback(
    ({item}: {item: MailMessageSummary}) => (
      <MailSummaryRow item={item} sent={sent} onOpen={openMessage} />
    ),
    [sent, openMessage],
  );

  const emptyLabel = loadError ? loadError : status || 'Mailbox empty.';

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {unlockPrompt}
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
                pageRef.current = 1;
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
          value={customFolderDraft}
          onChangeText={setCustomFolderDraft}
          onBlur={() => {
            pageRef.current = 1;
            setCustomFolder(customFolderDraft);
          }}
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
          pageRef.current = 1;
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
          pageRef.current = 1;
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
          pageRef.current = 1;
          setLimit(Number(clamped));
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

      <AppButton
        title="Refresh"
        variant="secondary"
        onPress={() => void load(undefined, true)}
      />
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
      <Card style={styles.listCard}>
        <FlatList
          data={messages}
          keyExtractor={messageKey}
          ListEmptyComponent={
            <Text style={[styles.empty, loadError ? styles.emptyError : null]}>
              {emptyLabel}
            </Text>
          }
          renderItem={renderMessage}
        />
      </Card>
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
