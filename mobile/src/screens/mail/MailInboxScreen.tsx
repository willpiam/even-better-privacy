import React, {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
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
import {moveMailboxMessage, clampMailLimit} from '../../services/mail/imap';
import type {ListMailboxMessagesResult} from '../../services/mail/imap';
import {
  getCachedMailPage,
  refreshMailPage,
  invalidateMailBodies,
  invalidateMailPages,
} from '../../services/mail/mailData';
import {onMailCacheCleared} from '../../services/mail/mailCache';
import type {MailMessageSummary} from '../../services/mail/types';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import {layout, radius, spacing, typography} from '../../theme/tokens';
import StatusBanner from '../../components/StatusBanner';
import TextField from '../../components/TextField';
import FoxArt from '../../components/FoxArt';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {
  MailAvatar,
  MailIcon,
  mailColors,
  mailDateLabel,
  mailSenderLabel,
} from './MailAppearance';

import SwipeMailRow, {type MailSwipeAction} from './SwipeMailRow';

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
  onAction,
  disabled,
}: {
  item: MailMessageSummary;
  sent: boolean;
  disabled: boolean;
  onAction: (uid: number, action: MailSwipeAction) => Promise<void>;
  onOpen: (uid: number) => void;
}) {
  const address = sent ? item.to : item.from;
  const unread = !item.seen;
  return (
    <SwipeMailRow
      disabled={disabled}
      onAction={action => onAction(item.uid, action)}>
      <Pressable
        accessibilityActions={[
          {name: 'archive', label: 'Archive'},
          {name: 'delete', label: 'Delete'},
        ]}
        onAccessibilityAction={event => {
          const action = event.nativeEvent.actionName;
          if (!disabled && (action === 'archive' || action === 'delete'))
            void onAction(item.uid, action);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${
          sent ? 'To: ' : ''
        }${address}. ${item.subject || '(no subject)'}. ${item.date}`}
        style={({pressed}) => [styles.messageRow, pressed && styles.pressedRow]}
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
    </SwipeMailRow>
  );
});
function MessageSeparator() {
  return (
    <View style={styles.separatorTrack}>
      <View style={styles.separator} />
    </View>
  );
}

const messageKey = (item: MailMessageSummary) => String(item.uid);

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const requestId = useRef(0);
  const pageRef = useRef(1);
  const [showOptions, setShowOptions] = useState(false);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [mailbox, setMailbox] = useState<{
    folder: string;
    uidValidity?: number;
    identityName: string;
    accountId: string;
    accountUpdatedAt: number;
  } | null>(null);
  const [status, setStatus] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [secretsLocked, setSecretsLocked] = useState(false);
  const [folderPreset, setFolderPreset] =
    useState<(typeof FOLDER_PRESETS)[number]>('INBOX');
  const [customFolder, setCustomFolder] = useState('');
  const [customFolderDraft, setCustomFolderDraft] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
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
        setMailbox(null);
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
        const showPage = (result: ListMailboxMessagesResult) => {
          setMessages(result.messages);
          setMailbox({
            folder: result.folder,
            uidValidity: result.uidValidity,
            identityName,
            accountId: resolved.account.id,
            accountUpdatedAt: resolved.account.updatedAt,
          });
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
        cached = getCachedMailPage(identityName, resolved, params);
        if (cached) showPage(cached);
        else {
          setMessages([]);
          setMailbox(null);
          setTotal(0);
          setTotalPages(1);
        }
        if (refresh) invalidateMailBodies();
        const result = await refreshMailPage(identityName, resolved, params);
        if (current()) showPage(result);
      } catch (error) {
        if (!current()) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        setStatus(message);
        if (!cached) {
          setMessages([]);
          setMailbox(null);
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
          style={({pressed}) => [
            styles.compose,
            pressed && styles.pressedControl,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Compose"
          onPress={() => navigation.navigate('MailCompose')}>
          <MailIcon name="compose" />
          <Text style={styles.headerAction}>Compose</Text>
        </Pressable>
      ),
    });
  }, [navigation, folder]);

  const openMailAccountSettings = () =>
    navigation.getParent()?.navigate('MoreTab', {
      screen: 'MailAccountSettings',
      initial: false,
    });

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
      if (!mailbox) return;
      const {folder, uidValidity, identityName, accountId} = mailbox;
      navigation.navigate('MailMessage', {uid, folder, uidValidity, identityName, accountId});
    },
    [navigation, mailbox],
  );
  const moving = useRef(false);
  const moveMessage = useCallback(
    async (uid: number, action: MailSwipeAction) => {
      if (moving.current || !mailbox) return;
      moving.current = true;
      const currentRequest = requestId.current;
      try {
        const identity = await getCurrentIdentityRequired();
        const context = await resolveSelectedAccount(identity);
        if (!context) throw new Error('Configure a mail account first');
        if (currentRequest !== requestId.current) return;
        if (
          identity !== mailbox.identityName ||
          context.account.id !== mailbox.accountId ||
          context.account.updatedAt !== mailbox.accountUpdatedAt
        ) {
          throw new Error('The mail account changed. Refresh the message list.');
        }
        await moveMailboxMessage(
          context.account.config,
          context.secrets,
          uid,
          mailbox.folder,
          action,
          mailbox.uidValidity,
        );
        invalidateMailPages();
        invalidateMailBodies();
        if (currentRequest === requestId.current) {
          setMessages(previous => previous.filter(item => item.uid !== uid));
          await load();
        }
      } catch (error) {
        Alert.alert(
          'Could not move message',
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        moving.current = false;
      }
    },
    [mailbox, load],
  );
  const sent = isSentFolderRequest(folder);
  const renderMessage = useCallback(
    ({item}: {item: MailMessageSummary}) => (
      <MailSummaryRow
        item={item}
        sent={sent}
        onOpen={openMessage}
        disabled={loading}
        onAction={moveMessage}
      />
    ),
    [sent, openMessage, loading, moveMessage],
  );

  const emptyLabel = loadError ? loadError : status || 'Mailbox empty.';

  return (
    <Screen contentStyle={styles.content}>
      {unlockPrompt}
      <View style={styles.heading}>
        <Text style={styles.accountEmail} numberOfLines={2}>
          {accountEmail || 'Your mailbox'}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh messages"
          disabled={loading}
          onPress={() => void load(undefined, true)}
          style={({pressed}) => [
            styles.iconButton,
            pressed && styles.pressedControl,
          ]}>
          <MailIcon name="refresh" />
        </Pressable>
      </View>
      <View style={[styles.search, searchFocused && styles.searchFocused]}>
        <TextInput
          accessibilityLabel="Search mail"
          placeholder="Search your mail"
          placeholderTextColor={mailColors.muted}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
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
          style={({pressed}) => [
            styles.iconButton,
            pressed && styles.pressedControl,
          ]}
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
                style={({pressed}) => [
                  styles.folderChip,
                  pressed && styles.pressedControl,
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
      <FlatList
        style={styles.messageList}
        data={messages}
        ItemSeparatorComponent={MessageSeparator}
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
                  onPress={openMailAccountSettings}
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
                  onPress={() => void onUnlock()}
                />
                <AppButton
                  title="Back to Mail"
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
                  onPress={openMailAccountSettings}
                />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !loading && !loadError ? (
            <View style={styles.empty}>
              <FoxArt place="mail" size={120} />
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
                style={styles.pagerButton}
                disabled={loading || page <= 1}
                onPress={() => void load(page - 1)}
              />
              <Text style={styles.pageInfo}>
                {page} / {totalPages}
              </Text>
              <AppButton
                title="Next"
                variant="secondary"
                style={styles.pagerButton}
                disabled={loading || page >= totalPages}
                onPress={() => void load(page + 1)}
              />
            </View>
          ) : null
        }
        renderItem={renderMessage}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 0,
    paddingTop: spacing.md,
    paddingBottom: 0,
    gap: spacing.sm,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.gutter,
  },
  accountEmail: {
    flex: 1,
    fontSize: typography.body,
    color: mailColors.text,
  },
  compose: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.controlHeight - 4,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    gap: spacing.sm,
  },
  headerAction: {
    color: mailColors.accent,
    fontWeight: '600',
    fontSize: typography.body,
  },
  iconButton: {
    minWidth: layout.controlHeight - 4,
    minHeight: layout.controlHeight - 4,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: mailColors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: mailColors.fieldBorder,
    marginHorizontal: layout.gutter,
    paddingStart: spacing.md,
  },
  searchFocused: {borderColor: mailColors.accent},
  searchInput: {
    flex: 1,
    fontSize: typography.body,
    color: mailColors.text,
    paddingVertical: 12,
    minWidth: 0,
  },
  folderRow: {gap: spacing.xs, paddingHorizontal: layout.gutter},
  folderChip: {
    paddingHorizontal: 16,
    minHeight: layout.controlHeight - 4,
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  folderChipSelected: {backgroundColor: mailColors.accentSoft},
  folderChipText: {color: mailColors.muted, fontSize: typography.body},
  folderChipTextSelected: {color: mailColors.accent, fontWeight: '700'},
  messageList: {flex: 1},
  listHeading: {
    paddingHorizontal: layout.gutter,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  messageCount: {
    color: mailColors.muted,
    fontSize: typography.caption,
    paddingVertical: spacing.md,
  },
  optionsButton: {
    minHeight: layout.controlHeight - 4,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  link: {
    fontSize: typography.caption,
    color: mailColors.accent,
    fontWeight: '600',
  },
  options: {
    paddingHorizontal: layout.gutter,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  messageRow: {
    backgroundColor: mailColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.md,
    minHeight: 68,
  },
  pressedControl: {backgroundColor: mailColors.soft},
  separatorTrack: {backgroundColor: mailColors.surface},
  separator: {
    backgroundColor: mailColors.border,
    height: StyleSheet.hairlineWidth,
    marginStart: layout.gutter + layout.avatarSize + spacing.md,
    marginEnd: layout.gutter,
  },
  pressedRow: {backgroundColor: mailColors.soft},
  messageCopy: {flex: 1, gap: spacing.xs},
  rowTop: {flexDirection: 'row', alignItems: 'baseline', gap: 8},
  sender: {flex: 1, color: mailColors.text, fontSize: typography.body},
  unreadText: {fontWeight: '700'},
  date: {color: mailColors.muted, fontSize: typography.caption, flexShrink: 1},
  subjectRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  subject: {
    flex: 1,
    color: mailColors.text,
    fontSize: typography.body,
    lineHeight: 21,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: mailColors.accent,
  },
  empty: {alignItems: 'center', padding: 28, paddingVertical: 48, gap: 12},
  emptyTitle: {
    color: mailColors.text,
    fontSize: typography.title,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyText: {
    color: mailColors.muted,
    fontSize: typography.body,
    lineHeight: 21,
    textAlign: 'center',
  },
  pagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  pagerButton: {flex: 1},
  pageInfo: {
    flexShrink: 1,
    color: mailColors.muted,
    fontSize: typography.caption,
    textAlign: 'center',
  },
});
