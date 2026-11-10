import React, {useCallback, useState} from 'react';
import {FlatList, StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {ChatStackParamList} from '../../navigation/AppNavigator';
import type {ChatConversation} from '../../../../common/ChatChannel';
import {getCurrentIdentityRequired} from '../../services/storage';
import {getMailSecretsStatus} from '../../services/mail/accountStore';
import {loadChatConversations} from '../../services/mail/chat';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import ListRow from '../../components/ListRow';
import StatusBanner from '../../components/StatusBanner';
import InlineBusy from '../../components/InlineBusy';
import {useIdentityUnlock} from '../../hooks/useIdentityUnlock';
import {colors, spacing, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<ChatStackParamList, 'ChatHome'>;

const REFRESH_MS = 20_000;

function labelFor(item: ChatConversation): string {
  return item.peer;
}

export default function ChatHomeScreen({navigation}: Props): JSX.Element {
  const {ensureUnlocked, unlockPrompt} = useIdentityUnlock();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (allowPrompt: boolean) => {
    setLoading(true);
    setError(null);
    try {
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
      setConversations(result.conversations);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [ensureUnlocked]);

  useFocusEffect(
    useCallback(() => {
      void load(true);
      const timer = setInterval(() => {
        void load(false);
      }, REFRESH_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  return (
    <Screen>
      {unlockPrompt}
      {error ? <StatusBanner message={error} kind="error" /> : null}
      <AppButton
        title="New chat"
        testID="chat-new"
        onPress={() => navigation.navigate('ChatNew')}
      />
      {loading && conversations.length === 0 ? <InlineBusy /> : null}
      <FlatList
        data={conversations}
        keyExtractor={item => item.peer}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          loading ? null : <Text style={styles.empty}>No chats yet</Text>
        }
        renderItem={({item}) => (
          <ListRow
            title={labelFor(item)}
            subtitle={item.latestDate ? new Date(item.latestDate).toLocaleString() : ''}
            badge={item.unread ? String(item.unread) : undefined}
            avatarText={item.peer}
            onPress={() => navigation.navigate('ChatThread', {peer: item.peer})}
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  empty: {
    color: colors.muted,
    fontSize: typography.body,
    padding: spacing.lg,
  },
});
