import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  TextInput,
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
} from '../../services/mail/accountStore';
import {isSentFolderRequest} from '../../../../common/SentMailbox';
import {clampMailLimit} from '../../services/mail/imap';
import type {ListMailboxMessagesResult} from '../../services/mail/imap';
import {
  getCachedMailPage,
  refreshMailPage,
  invalidateMailBodies,
} from '../../services/mail/mailData';
import {onMailCacheCleared} from '../../services/mail/mailCache';
import type {MailMessageSummary} from '../../services/mail/types';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import StatusBanner from '../../components/StatusBanner';
import TextField from '../../components/TextField';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {
  MailAvatar,
  MailIcon,
  mailColors,
  mailDateLabel,
  mailSenderLabel,
} from './MailAppearance';

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
  const address = sent ? item.to : item.from;
  const unread = !item.seen;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${
        sent ? 'To: ' : ''
      }${address}. ${item.subject || '(no subject)'}. ${item.date}`}
      style={({pressed}) => [
        styles.messageRow,
        unread && styles.unreadRow,
        pressed && styles.pressedRow,
      ]}
      onPress={() => onOpen(item.uid)}>
      <MailAvatar address={address} />
      <View style={styles.messageCopy}>
        <View style={styles.rowTop}>
          <Text
            numberOfLines={1}
            style={[styles.sender, unread && styles.unreadText]}>
            {sent ? 'To: ' : ''}
            {mailSenderLabel(address)}
          </Text>
          <Text style={styles.date}>{mailDateLabel(item.date)}</Text>
        </View>
        <View style={styles.subjectRow}>
          {unread ? <View style={styles.unreadDot} /> : null}
          <Text
            numberOfLines={2}
            style={[styles.subject, unread && styles.unreadText]}>
            {item.subject || '(no subject)'}
          </Text>
        </View>
      </View>
    </Pressable>
  );
});
const messageKey = (item: MailMessageSummary) => String(item.uid);

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const requestId = useRef(0);
  const pageRef = useRef(1);
  const [showOptions, setShowOptions] = useState(false);
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
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const folder = useMemo(() => {
    if (folderPreset === 'Custom') {
      return customFolder.trim() || 'INBOX';
    }
    return folderPreset;
  }, [folderPreset, customFolder]);

  const [limit, setLimit] = useState(20);

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
        <Pressable
          style={styles.compose}
          accessibilityRole="button"
          accessibilityLabel="Compose"
          onPress={() => navigation.navigate('MailCompose')}>
          <MailIcon name="compose" />
          <Text style={styles.headerAction}>Compose</Text>
        </Pressable>
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
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>YOUR MAIL</Text>
          <Text style={styles.accountEmail} numberOfLines={1}>
            {accountEmail || 'Your mailbox'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh messages"
          disabled={loading}
          onPress={() => void load(undefined, true)}
          style={styles.iconButton}>
          <MailIcon name="refresh" />
        </Pressable>
      </View>
      <View style={styles.search}>
        <TextInput
          accessibilityLabel="Search mail"
          placeholder="Search your mail"
          placeholderTextColor={mailColors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          value={searchDraft}
          onChangeText={setSearchDraft}
          returnKeyType="search"
          onSubmitEditing={() => {
            setSearch(searchDraft.trim());
            pageRef.current = 1;
            setPage(1);
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          style={styles.iconButton}
          onPress={() => {
            setSearch(searchDraft.trim());
            pageRef.current = 1;
            setPage(1);
          }}>
          <MailIcon name="search" />
        </Pressable>
      </View>
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.folderRow}>
          {FOLDER_PRESETS.map(name => {
            const selected = folderPreset === name;
            return (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{selected}}
                onPress={() => {
                  setFolderPreset(name);
                  pageRef.current = 1;
                  setPage(1);
                }}
                style={[
                  styles.folderChip,
                  selected && styles.folderChipSelected,
                ]}>
                <Text
                  style={[
                    styles.folderChipText,
                    selected && styles.folderChipTextSelected,
                  ]}>
                  {name === 'INBOX' ? 'Inbox' : name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <Card style={styles.listCard}>
        <FlatList
          data={messages}
          keyExtractor={messageKey}
          refreshing={loading}
          onRefresh={() => void load(undefined, true)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View style={styles.listHeading}>
                <Text style={styles.messageCount}>
                  {loading
                    ? 'Loading messages…'
                    : `${total} ${total === 1 ? 'message' : 'messages'}`}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{expanded: showOptions}}
                  onPress={() => setShowOptions(v => !v)}
                  style={styles.optionsButton}>
                  <Text style={styles.link}>
                    {showOptions ? 'Hide options' : 'Mailbox options'}
                  </Text>
                </Pressable>
              </View>
              {folderPreset === 'Custom' ? (
                <View style={styles.options}>
                  <TextField
                    label="Custom folder"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={customFolderDraft}
                    onChangeText={setCustomFolderDraft}
                    onBlur={() => {
                      pageRef.current = 1;
                      setCustomFolder(customFolderDraft);
                      setPage(1);
                    }}
                    placeholder="[Gmail]/Sent Mail"
                  />
                </View>
              ) : null}
              {showOptions ? (
                <View style={styles.options}>
                  <TextField
                    label="Messages per page (1–100)"
                    keyboardType="number-pad"
                    value={limitText}
                    onChangeText={setLimitText}
                    onBlur={() => {
                      const clamped = clampMailLimit(Number(limitText) || 20);
                      setLimitText(String(clamped));
                      setLimit(clamped);
                      pageRef.current = 1;
                      setPage(1);
                    }}
                  />
                  <AppButton
                    title="Mail accounts"
                    variant="secondary"
                    onPress={() => navigation.navigate('MailAccounts')}
                  />
                </View>
              ) : null}
              {secretsLocked ? (
                <View style={styles.options}>
                  <Text style={styles.emptyText}>
                    Unlock your identity to load messages.
                  </Text>
                  <AppButton
                    title="Unlock secrets"
                    style={styles.primary}
                    onPress={() => void onUnlock()}
                  />
                  <AppButton
                    title="Open Mail Accounts"
                    variant="secondary"
                    onPress={() => navigation.navigate('MailAccounts')}
                  />
                </View>
              ) : null}
              {loadError && !secretsLocked ? (
                <View style={styles.options}>
                  <StatusBanner message={loadError} kind="error" />
                  <AppButton
                    title="Retry"
                    variant="secondary"
                    onPress={() => void load(undefined, true)}
                  />
                  <AppButton
                    title="Mail accounts"
                    variant="secondary"
                    onPress={() => navigation.navigate('MailAccounts')}
                  />
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            !loading && !loadError ? (
              <View style={styles.empty}>
                <MailIcon name="mail" />
                <Text style={styles.emptyTitle}>
                  {search ? 'No matching messages' : emptyLabel}
                </Text>
                <Text style={styles.emptyText}>
                  {search
                    ? 'Try another name or phrase.'
                    : 'New messages will appear here. Pull down to refresh.'}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            totalPages > 1 ? (
              <View style={styles.pagerRow}>
                <AppButton
                  title="Previous"
                  variant="secondary"
                  disabled={loading || page <= 1}
                  onPress={() => void load(page - 1)}
                />
                <Text style={styles.pageInfo}>
                  {page} / {totalPages}
                </Text>
                <AppButton
                  title="Next"
                  variant="secondary"
                  disabled={loading || page >= totalPages}
                  onPress={() => void load(page + 1)}
                />
              </View>
            ) : null
          }
          renderItem={renderMessage}
        />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {backgroundColor: mailColors.page},
  content: {flex: 1, padding: 16, paddingBottom: 12, gap: 14},
  heading: {flexDirection: 'row', alignItems: 'center', gap: 12},
  headingCopy: {flex: 1, gap: 5},
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.8,
    color: mailColors.muted,
    fontWeight: '600',
  },
  accountEmail: {fontSize: 15, color: mailColors.text},
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    gap: 6,
  },
  headerAction: {color: mailColors.accent, fontWeight: '600', fontSize: 15},
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: mailColors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: mailColors.border,
    paddingLeft: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: mailColors.text,
    paddingVertical: 12,
    minWidth: 0,
  },
  folderRow: {gap: 8},
  folderChip: {
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 22,
  },
  folderChipSelected: {backgroundColor: mailColors.accentSoft},
  folderChipText: {color: mailColors.muted, fontSize: 14},
  folderChipTextSelected: {color: mailColors.accent, fontWeight: '700'},
  listCard: {flex: 1, borderRadius: 16, borderColor: mailColors.border},
  listHeading: {
    paddingLeft: 16,
    paddingRight: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: mailColors.border,
  },
  messageCount: {color: mailColors.muted, fontSize: 12, paddingVertical: 12},
  optionsButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  link: {fontSize: 12, color: mailColors.accent, fontWeight: '600'},
  options: {padding: 16, gap: 12},
  primary: {backgroundColor: mailColors.accent},
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    minHeight: 94,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: mailColors.border,
  },
  unreadRow: {backgroundColor: '#fbfcf9'},
  pressedRow: {backgroundColor: mailColors.soft},
  messageCopy: {flex: 1, gap: 7},
  rowTop: {flexDirection: 'row', alignItems: 'baseline', gap: 8},
  sender: {flex: 1, color: mailColors.text, fontSize: 14},
  unreadText: {fontWeight: '700'},
  date: {color: mailColors.muted, fontSize: 11, flexShrink: 1},
  subjectRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  subject: {flex: 1, color: mailColors.text, fontSize: 15, lineHeight: 21},
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: mailColors.accent,
  },
  empty: {alignItems: 'center', padding: 28, paddingVertical: 48, gap: 12},
  emptyTitle: {
    color: mailColors.text,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    color: mailColors.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  pagerRow: {flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8},
  pageInfo: {
    flex: 1,
    color: mailColors.muted,
    fontSize: 12,
    textAlign: 'center',
  },
});
