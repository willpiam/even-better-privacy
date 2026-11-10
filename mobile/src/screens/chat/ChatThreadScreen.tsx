import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {BottomTabNavigationProp} from '@react-navigation/bottom-tabs';
import {
  latestThreadingTarget,
  messagesForThreadBodies,
  type ChatThreadMessage,
} from '../../../../common/ChatChannel';
import type {ChatStackParamList, RootTabParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {getMailSecretsStatus} from '../../services/mail/accountStore';
import {loadChatConversations, markChatSeen} from '../../services/mail/chat';
import {decryptMailBody, sendEbpMail} from '../../services/mail/ebpMail';
import {resolveVerifiedRecipient} from '../../services/contacts';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import Screen from '../../components/Screen';
import TextField from '../../components/TextField';
import AppButton from '../../components/AppButton';
import StatusBanner from '../../components/StatusBanner';
import {colors, radius, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatThread'>;
type Bubble = {ok: true; text: string} | {ok: false};

const REFRESH_MS = 20_000;

export default function ChatThreadScreen({navigation, route}: Props): JSX.Element {
  const peer = route.params.peer;
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [contactName, setContactName] = useState(route.params.contactName ?? '');
  const [messages, setMessages] = useState<ChatThreadMessage[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const bubbles = useRef<Record<string, Bubble>>({});
  const markedSeen = useRef(new Set<string>());

  const load = useCallback(async (allowPrompt: boolean) => {
    let identityName: string;
    if (allowPrompt) {
      const unlocked = await ensureUnlocked();
      if (!unlocked) {
        throw new Error('Unlock cancelled');
      }
      identityName = unlocked;
    } else {
      identityName = await getCurrentIdentityRequired();
      const secretStatus = await getMailSecretsStatus(identityName);
      if (secretStatus.locked && !secretStatus.inMemory) {
        throw new Error('Mail secrets locked');
      }
    }
    const result = await loadChatConversations(identityName);
    const conversation = result.conversations.find(item => item.peer === peer);
    const rows = conversation?.messages ?? [];
    const threadWindow = messagesForThreadBodies(rows);
    setMessages(threadWindow.shown);
    setHiddenCount(threadWindow.hiddenCount);
    const unseen = rows.filter(item => {
      const key = `${item.folder}:${item.uid}`;
      return !item.outbound && !item.seen && !markedSeen.current.has(key);
    });
    const byFolder = new Map<string, number[]>();
    for (const item of unseen) {
      const list = byFolder.get(item.folder) ?? [];
      list.push(item.uid);
      byFolder.set(item.folder, list);
    }
    for (const [folder, uids] of byFolder) {
      await markChatSeen(identityName, folder, uids);
      for (const uid of uids) {
        markedSeen.current.add(`${folder}:${uid}`);
      }
    }
    setError(null);
  }, [peer, ensureUnlocked]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void load(true).catch(err => {
        if (alive) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
      const timer = setInterval(() => {
        void load(false).catch(err => {
          if (alive) {
            setError(err instanceof Error ? err.message : String(err));
          }
        });
      }, REFRESH_MS);
      return () => {
        alive = false;
        clearInterval(timer);
      };
    }, [load]),
  );

  const shownKey = messages.map(item => `${item.folder}:${item.uid}`).join('|');

  useEffect(() => {
    let cancelled = false;
    async function decrypt() {
      const identityName = await ensureUnlocked();
      if (!identityName || cancelled) {
        return;
      }
      for (const message of messages) {
        if (cancelled) {
          return;
        }
        const key = `${message.folder}:${message.uid}`;
        if (bubbles.current[key]) {
          continue;
        }
        try {
          const summary = await decryptMailBody({
            identityName,
            uid: message.uid,
            folder: message.folder,
          });
          bubbles.current[key] =
            summary.verified === true
              ? {ok: true, text: summary.plaintext}
              : {ok: false};
        } catch {
          bubbles.current[key] = {ok: false};
        }
        if (!cancelled) {
          setTick(value => value + 1);
        }
      }
    }
    void decrypt();
    return () => {
      cancelled = true;
    };
  }, [shownKey, messages, ensureUnlocked]);

  const data = useMemo(() => messages, [messages, tick]);

  async function send() {
    const text = draft.trim();
    if (!text) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      const identityName = await ensureUnlocked();
      if (!identityName) {
        return;
      }
      let name = contactName;
      if (!name) {
        const match = await resolveVerifiedRecipient(peer);
        if (match.status !== 'unique') {
          throw new Error(
            match.status === 'ambiguous'
              ? 'More than one verified identity publishes this address.'
              : 'No verified identity for that address.',
          );
        }
        name = match.name;
      }
      const thread = latestThreadingTarget(messages);
      await sendEbpMail({
        identityName,
        channel: 'chat',
        to: peer,
        subject: 'Chat',
        message: text,
        recipientContact: name,
        recipients: [{email: peer, contact: name}],
        inReplyTo: thread?.inReplyTo,
        references: thread?.references,
      });
      setContactName(name);
      setDraft('');
      await load(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  function openInMail(message: ChatThreadMessage) {
    const parent = navigation.getParent<BottomTabNavigationProp<RootTabParamList>>();
    parent?.navigate('MailTab', {
      screen: 'MailMessage',
      params: {uid: message.uid, folder: message.folder},
    });
  }

  return (
    <Screen>
      {unlockPrompt}
      {error ? <StatusBanner message={error} kind="error" /> : null}
      <FlatList
        data={data}
        keyExtractor={item => `${item.folder}:${item.uid}`}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          hiddenCount > 0 ? (
            <Text style={styles.note}>{hiddenCount} earlier messages are not loaded</Text>
          ) : null
        }
        ListEmptyComponent={<Text style={styles.note}>No messages yet</Text>}
        renderItem={({item}) => {
          const bubble = bubbles.current[`${item.folder}:${item.uid}`];
          const outbound = item.outbound;
          if (bubble && !bubble.ok) {
            return (
              <View style={[styles.bubble, styles.errorBubble]}>
                <Text style={styles.errorText}>This message could not be verified.</Text>
                <Pressable onPress={() => openInMail(item)}>
                  <Text style={styles.link}>Open in Mail</Text>
                </Pressable>
              </View>
            );
          }
          return (
            <View style={[styles.bubble, outbound ? styles.outbound : styles.inbound]}>
              <Text style={styles.body}>
                {bubble?.ok ? bubble.text : 'Encrypted'}
              </Text>
              <Text style={styles.time}>
                {item.date ? new Date(item.date).toLocaleString() : ''}
              </Text>
            </View>
          );
        }}
      />
      <TextField
        label="Message"
        testID="chat-compose-body"
        multiline
        value={draft}
        onChangeText={setDraft}
      />
      <AppButton
        title="Send"
        testID="chat-send"
        loading={sending}
        disabled={!draft.trim()}
        onPress={() => {
          void send();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  note: {
    color: colors.muted,
    fontSize: typography.caption,
    marginBottom: spacing.sm,
  },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  inbound: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  outbound: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
  },
  errorBubble: {
    alignSelf: 'stretch',
    maxWidth: '100%',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: {
    color: colors.text,
    fontSize: typography.body,
  },
  time: {
    marginTop: spacing.xs,
    color: colors.muted,
    fontSize: typography.caption,
  },
  errorText: {
    color: colors.muted,
    fontSize: typography.body,
  },
  link: {
    marginTop: spacing.xs,
    color: colors.accent,
    fontSize: typography.body,
  },
});
