import React, {useCallback, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import AppButton from '../../components/AppButton';
import Card from '../../components/Card';
import ListRow from '../../components/ListRow';
import Screen from '../../components/Screen';
import SectionTitle from '../../components/SectionTitle';
import StatusBanner from '../../components/StatusBanner';
import type {MoreStackParamList} from '../../navigation/AppNavigator';
import {
  readMailStore,
  resolveSelectedAccountId,
  selectMailAccount,
} from '../../services/mail/accountStore';
import type {MailAccountStore} from '../../services/mail/types';
import {getCurrentIdentityRequired} from '../../services/storage';

type Props = NativeStackScreenProps<MoreStackParamList, 'MailAccountSettings'>;

export default function MailAccountSettingsScreen({
  navigation,
}: Props): JSX.Element {
  const [mail, setMail] = useState<{
    identityName: string;
    store: MailAccountStore;
  }>();
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      setMail(undefined);
      setError('');
      void (async () => {
        try {
          const identityName = await getCurrentIdentityRequired();
          const store = await readMailStore(identityName);
          if (focused) setMail({identityName, store});
        } catch (cause) {
          if (focused)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
      return () => {
        focused = false;
      };
    }, []),
  );

  const selectAccount = async (accountId: string) => {
    if (!mail) return;
    setSelecting(true);
    setError('');
    try {
      await selectMailAccount(mail.identityName, accountId);
      const store = await readMailStore(mail.identityName);
      setMail(current => (current === mail ? {...mail, store} : current));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSelecting(false);
    }
  };

  const selectedId = mail ? resolveSelectedAccountId(mail.store) : null;
  const multipleAccounts = (mail?.store.accounts.length ?? 0) > 1;

  return (
    <Screen scroll>
      {mail ? <SectionTitle>{mail.identityName}</SectionTitle> : null}
      <StatusBanner message={error} kind="error" />
      {mail?.store.accounts.map(account => (
        <Card key={account.id}>
          <ListRow
            title={account.name}
            subtitle={account.config.fromEmail || account.config.username}
            badge={
              multipleAccounts && account.id === selectedId
                ? 'Selected'
                : undefined
            }
            avatarText={account.name}
            onPress={() =>
              navigation.navigate('MailAccountSetup', {accountId: account.id})
            }
          />
          {account.id !== selectedId ? (
            <AppButton
              title="Select"
              variant="secondary"
              disabled={selecting}
              onPress={() => void selectAccount(account.id)}
            />
          ) : null}
        </Card>
      ))}
      <AppButton
        title="Add account"
        variant="secondary"
        onPress={() => navigation.navigate('MailAccountSetup', {})}
      />
      <AppButton
        title="Create an EBP email address"
        variant="secondary"
        onPress={() => navigation.navigate('OnboardingWizard')}
      />
    </Screen>
  );
}
