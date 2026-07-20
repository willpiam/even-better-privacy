import React, {useCallback, useLayoutEffect, useState} from 'react';
import {FlatList, StyleSheet, Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import type {MailStackParamList} from '../../navigation/AppNavigator';
import {getCurrentIdentityRequired} from '../../services/storage';
import {resolveSelectedAccount} from '../../services/mail/accountStore';
import {listInboxMessages} from '../../services/mail/imap';
import type {MailMessageSummary} from '../../services/mail/types';
import Screen from '../../components/Screen';
import AppButton from '../../components/AppButton';
import ListRow from '../../components/ListRow';
import Card from '../../components/Card';
import InlineBusy from '../../components/InlineBusy';
import StatusBanner from '../../components/StatusBanner';
import {statusKind} from '../../theme/statusKind';
import {colors, typography} from '../../theme/tokens';

type Props = NativeStackScreenProps<MailStackParamList, 'MailInbox'>;

export default function MailInboxScreen({navigation}: Props): JSX.Element {
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [status, setStatus] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const identityName = await getCurrentIdentityRequired();
      const resolved = await resolveSelectedAccount(identityName);
      if (!resolved) {
        throw new Error('Configure a mail account first');
      }
      setAccountEmail(
        resolved.account.config.fromEmail || resolved.account.config.username,
      );
      const list = await listInboxMessages(
        resolved.account.config,
        resolved.secrets,
        40,
      );
      setMessages(list);
      setStatus(`Loaded ${list.length} messages`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      setMessages([]);
      setAccountEmail('');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
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

  return (
    <Screen style={styles.screen} contentStyle={styles.content}>
      {accountEmail ? (
        <Text style={styles.accountEmail}>{accountEmail}</Text>
      ) : null}
      <AppButton title="Refresh inbox" variant="secondary" onPress={load} />
      <StatusBanner message={status} kind={statusKind(status)} />
      {loading ? <InlineBusy message="Loading messages…" /> : null}
      {!loading ? (
        <Card style={styles.listCard}>
          <FlatList
            data={messages}
            keyExtractor={item => String(item.uid)}
            ListEmptyComponent={
              <Text style={styles.empty}>No messages loaded.</Text>
            }
            renderItem={({item}) => (
              <ListRow
                title={item.subject || '(no subject)'}
                subtitle={`${item.from} · ${item.date}`}
                onPress={() =>
                  navigation.navigate('MailMessage', {uid: item.uid})
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
  listCard: {flex: 1},
  empty: {
    color: colors.muted,
    padding: 16,
  },
});
